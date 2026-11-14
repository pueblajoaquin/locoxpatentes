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
- `MAIL_USER` y `MAIL_PASS`: cuenta Gmail y su *contraseña de aplicación* (16 caracteres, requiere verificación en 2 pasos). `MAIL_FROM` es opcional (default `MAIL_USER`).
- `APP_URL`: dominio público con HTTPS (ej. `https://tudominio.com`); es la base de los links de los mails. Sin `MAIL_USER`, `MAIL_PASS` y `APP_URL` la app no arranca.
- `HOST=127.0.0.1` (no cambiar) y `PORT=3000`.
- `MAX_UPLOAD_MB`: tamaño máximo de la foto (5 por defecto). Si lo subís, subí también `client_max_body_size` en Nginx.
- `MODERATORS`: usernames de los moderadores, separados por coma (distingue mayúsculas). Ver "Moderación" más abajo.

`.env` está en `.gitignore`: nunca se commitea. `chmod 600 .env`.

### Moderación

Cada avistamiento queda pendiente hasta que un moderador lo aprueba o lo rechaza en `https://tudominio.com/moderacion`.

- Un moderador no puede moderar sus propios envíos: hacen falta **al menos 2**. Con `MODERATORS` vacía la app arranca (con un warning en el log), pero nadie puede aprobar nada.
- Registrá y verificá las cuentas **antes** de listarlas: el registro es abierto, así que un username listado que todavía no existe lo puede registrar cualquiera.
- Los moderadores con correo verificado reciben un mail por cada envío nuevo.
- Para dar o quitar acceso: editá `MODERATORS` en `.env` y reiniciá con `pm2 reload locoxpatentes --update-env`. No depende del JWT: el cambio vale desde el reinicio. El moderador nuevo tiene que volver a iniciar sesión para ver el link "Moderación".

### Migración de moderación (una sola vez)

Toda base creada antes de la moderación necesita esta migración. Requiere **MongoDB ≥ 6.0** (Atlas lo cumple). Corréla junto con el despliegue del código nuevo, antes del `pm2 reload`:

```bash
cd ~/locoxpatentes/backend
npm run migrate:moderation
```

Marca como `approved` los avistamientos que ya existían y reemplaza el índice único de `licensePlate` por el parcial. Es idempotente: correrla de nuevo no cambia nada. Sin ella no hay punta (ningún avistamiento viejo cuenta como aprobado) y el índice nuevo no se puede crear. En una base nueva no hace falta.

Para confirmarla en Atlas: todos los documentos de `sightings` tienen `status` y el índice `licensePlate_1` tiene `partialFilterExpression`.

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

Si la versión nueva trae una migración (ver "Migración de moderación" en el paso 3), corréla antes del `pm2 reload`.

`pm2 reload` hace un reinicio sin cortar el servicio. Si cambiaste `.env`: `pm2 reload locoxpatentes --update-env`.

## Notas sobre la app

- **Fotos**: se guardan en `backend/uploads/` con nombre generado por el servidor (uuid). Solo existen las fotos de los avistamientos pendientes y la de la punta: al aprobar uno se borra la foto de la punta anterior, y al rechazarlo o quedar superado se borra la suya. Los avistamientos viejos quedan en la base con una `photoUrl` que da 404 (el front solo muestra la foto de la punta). La carpeta no se versiona (solo `.gitkeep`).
- **Caché**: las fotos y los archivos de `/assets` se sirven como inmutables (el nombre cambia siempre); `index.html` y `/api` con `no-cache`.
- **CORS**: no está habilitado a propósito. Front y API salen del mismo origen. Solo haría falta si el front se sirviera desde otro dominio.
- **Seguridad**: `helmet` agrega cabeceras (CSP, HSTS, etc.); `/uploads` no lista directorios ni sirve archivos ocultos; `trust proxy` = 1 para que el rate limit use la IP real del cliente.
- **Backups**: las fotos viven solo en el disco del servidor; hacé snapshots de DonWeb o `rsync` de `backend/uploads`.

## Checklist final

- [ ] `node -v` ≥ 22 (v24) en el servidor.
- [ ] `backend/dist/index.html` existe (build del front hecho).
- [ ] `backend/.env` existe, con `SECRET` propio y `MONGODB_URL` válida (`chmod 600`).
- [ ] `.env` tiene `MAIL_USER`, `MAIL_PASS` (contraseña de aplicación) y `APP_URL=https://tudominio.com` (sin barra final).
- [ ] `pm2 status` muestra `locoxpatentes` en `online` y `pm2 logs` sin errores.
- [ ] `curl -i http://127.0.0.1:3000/health` → 200.
- [ ] `ss -tlnp | grep 3000` muestra `127.0.0.1:3000` (no `0.0.0.0`).
- [ ] `sudo ufw status`: solo 22, 80 y 443.
- [ ] `sudo nginx -t` OK y `https://tudominio.com` carga con candado.
- [ ] `http://tudominio.com` redirige a HTTPS.
- [ ] `https://tudominio.com/health` → 200; una ruta del front (p. ej. `/algo`) carga la app; `/api/nada` da 404.
- [ ] Registro → llega el mail de verificación (revisar spam) y su link abre `https://tudominio.com/?verify=…` → login y envío de una patente con foto funcionan; la foto se ve.
- [ ] `.env` tiene `MODERATORS` con al menos 2 usernames ya registrados y `pm2 logs` no muestra el warning de `MODERATORS` vacía.
- [ ] Si la base ya tenía avistamientos: `npm run migrate:moderation` corrida y la punta anterior sigue apareciendo.
- [ ] Un envío nuevo queda "Pendiente" en "Mis envíos", la punta no cambia y a los moderadores les llega el mail; otro moderador lo aprueba en `/moderacion` → cambia la punta y al autor le llega el mail.
- [ ] "¿Olvidaste tu contraseña?" manda el mail y el link permite cambiarla.
- [ ] Foto de más de `MAX_UPLOAD_MB` o `.gif` → error claro (400).
- [ ] `https://tudominio.com/uploads/` no lista archivos.
- [ ] `pm2 startup` + `pm2 save` hechos: reiniciar el servidor (`sudo reboot`) y verificar que la app vuelve sola.
- [ ] `sudo certbot renew --dry-run` OK.
