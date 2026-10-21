# Loco x Patentes

A game about spotting Argentine license plates. Upload a plate (Mercosur format, e.g. `AB123CD`) with a photo. It only counts if the plate is **newer** than the current top, and then it becomes the new top.

Two rankings: most times being the top, and most total time as the top.

## Structure

This is a simple monorepo with two independent apps:

- `backend/` - Express 5 + MongoDB API (also serves the built frontend and the uploaded photos)
- `frontend/` - React 19 + Vite client

## Run

Backend (needs a `.env`, see `backend/.env.example`):

```
cd backend
npm install
npm run dev
```

Frontend (the dev server proxies `/api` and `/uploads` to the backend on port 3000):

```
cd frontend
npm install
npm run dev
```

## Tests and lint

```
cd backend
npm test
npm run lint
```

The endpoint tests wipe the database in `TEST_MONGODB_URL`, so it must be different from `MONGODB_URL`.

## API

- `POST /api/users` - sign up
- `POST /api/login` - log in, returns a JWT
- `POST /api/sightings` - submit a plate with a photo (multipart: `plate`, `photo`; needs the token)
- `GET /api/top` - current top
- `GET /api/history` - last 50 sightings
- `GET /api/ranking` - times being the top, per user
- `GET /api/ranking/time` - total time as the top, per user

## Deploy

See [DEPLOY.md](DEPLOY.md).
