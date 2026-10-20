# Loco x Patentes

A game about spotting Argentine license plates. Upload a plate (Mercosur format, e.g. `AB123CD`) with a photo. It only counts if the plate is **newer** than the current top, and then it becomes the new top.

Two rankings: most times being the top, and most total time as the top.

## Structure

This is a simple monorepo:

- `backend/` - Express + MongoDB API
- `frontend/` - React + Vite client

## Run

Backend (needs a `.env`, see `backend/.env.example`):

```
cd backend
npm install
npm run dev
```

Frontend:

```
cd frontend
npm install
npm run dev
```
