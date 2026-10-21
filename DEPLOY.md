# Despliegue en un VPS (Ubuntu 24.04 + Nginx + PM2 + Certbot)

Guía para un único servidor (DonWeb Cloud Server, 1 GB de RAM), un dominio, sin Docker. Reemplazá `tudominio.com` y `TU_USUARIO` por los tuyos.

Arquitectura: Nginx (80/443) → Express en `127.0.0.1:3000` (PM2). Express sirve la API, el front (`backend/dist`) y las fotos (`backend/uploads`). MongoDB va aparte (se recomienda Atlas: `index.js` ya está pensado para el SRV de Atlas).

## 0. Antes de empezar (en tu máquina)

- `dist/` **no se versiona**: el front se compila en el servidor (paso 2) directamente en `backend/dist`.
- Apuntá el registro DNS **A** de `tudominio.com` a la IP del servidor.
- En Atlas, permití la IP del servidor en *Network Access*.

## 1. Preparar el servidor

```bash
ssh TU_USUARIO@IP_DEL_SERVIDOR

sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git ufw certbot python3-certbot-nginx

# firewall: SSH + HTTP/HTTPS (el puerto 3000 NO se abre)
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Node 24 (NodeSource) y PM2
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v   # v24.x
```

Recomendado: usar un usuario sin privilegios (no `root`) y deshabilitar la contraseña en SSH (solo clave).

## 2. Clonar e instalar

```bash
cd ~
git clone URL_DEL_REPO locoxpatentes
cd locoxpatentes/backend
npm ci --omit=dev

# front: compila directo en backend/dist (Express lo sirve desde ahí)
cd ../frontend
npm ci
npx vite build --outDir ../backend/dist --emptyOutDir
```

Con 1 GB de RAM el build puede quedarse sin memoria; si pasa, agregá swap (`sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`). Las dependencias de `frontend/` son solo de build: si querés, borrá `frontend/node_modules` después.

## 3. Variables de entorno

```bash
cp .env.example .env
nano .env
```

- `SECRET`: string largo y aleatorio (`openssl rand -hex 48`). Sin `SECRET` y `MONGODB_URL` la app no arranca.
- `MONGODB_URL`: la cadena de Atlas.
- `HOST=127.0.0.1` (no cambiar) y `PORT=3000`.
- `MAX_UPLOAD_MB`: tamaño máximo de la foto (5 por defecto). Si lo subís, subí también `client_max_body_size` en Nginx.

`.env` está en `.gitignore`: nunca se commitea. `chmod 600 .env`.

## 4. Arrancar con PM2

Desde la raíz del repo:

```bash
cd ~/locoxpatentes
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # ejecutá el comando `sudo env PATH=...` que imprime
pm2 logs locoxpatentes --lines 30
```

Prueba local: `curl -i http://127.0.0.1:3000/health` → `200`.

## 5. Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/locoxpatentes
sudo nano /etc/nginx/sites-available/locoxpatentes     # cambiá tudominio.com
sudo ln -s /etc/nginx/sites-available/locoxpatentes /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 6. HTTPS con Certbot

```bash
sudo certbot --nginx -d tudominio.com
sudo certbot renew --dry-run     # la renovación automática ya queda en un timer de systemd
```

Certbot agrega el bloque `443` y la redirección de HTTP a HTTPS en el archivo del sitio.

## 7. Actualizar la app

```bash
cd ~/locoxpatentes
git pull
(cd backend && npm ci --omit=dev)
# solo si cambió el front:
(cd frontend && npm ci && npx vite build --outDir ../backend/dist --emptyOutDir)
pm2 reload ecosystem.config.js
```

`pm2 reload` hace un reinicio sin cortar el servicio. Si cambiaste `.env`: `pm2 reload locoxpatentes --update-env`.

## Notas sobre la app

- **Fotos**: se guardan en `backend/uploads/` con nombre generado por el servidor (uuid). Al guardar un avistamiento nuevo se borra la foto de la punta anterior; los avistamientos viejos quedan en la base con una `photoUrl` que da 404 (el front solo muestra la foto de la punta). La carpeta no se versiona (solo `.gitkeep`).
- **Caché**: las fotos y los archivos de `/assets` se sirven como inmutables (el nombre cambia siempre); `index.html` y `/api` con `no-cache`.
- **CORS**: no está habilitado a propósito. Front y API salen del mismo origen. Solo haría falta si el front se sirviera desde otro dominio.
- **Seguridad**: `helmet` agrega cabeceras (CSP, HSTS, etc.); `/uploads` no lista directorios ni sirve archivos ocultos; `trust proxy` = 1 para que el rate limit use la IP real del cliente.
- **Backups**: las fotos viven solo en el disco del servidor; hacé snapshots de DonWeb o `rsync` de `backend/uploads`.

## Checklist final

- [ ] `node -v` ≥ 22 (v24) en el servidor.
- [ ] `backend/dist/index.html` existe (build del front hecho).
- [ ] `backend/.env` existe, con `SECRET` propio y `MONGODB_URL` válida (`chmod 600`).
- [ ] `pm2 status` muestra `locoxpatentes` en `online` y `pm2 logs` sin errores.
- [ ] `curl -i http://127.0.0.1:3000/health` → 200.
- [ ] `ss -tlnp | grep 3000` muestra `127.0.0.1:3000` (no `0.0.0.0`).
- [ ] `sudo ufw status`: solo 22, 80 y 443.
- [ ] `sudo nginx -t` OK y `https://tudominio.com` carga con candado.
- [ ] `http://tudominio.com` redirige a HTTPS.
- [ ] `https://tudominio.com/health` → 200; una ruta del front (p. ej. `/algo`) carga la app; `/api/nada` da 404.
- [ ] Registro, login y envío de una patente con foto funcionan; la foto se ve.
- [ ] Foto de más de `MAX_UPLOAD_MB` o `.gif` → error claro (400).
- [ ] `https://tudominio.com/uploads/` no lista archivos.
- [ ] `pm2 startup` + `pm2 save` hechos: reiniciar el servidor (`sudo reboot`) y verificar que la app vuelve sola.
- [ ] `sudo certbot renew --dry-run` OK.
