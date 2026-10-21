import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import userRoutes from './controllers/user.controller.js'
import loginRoutes from './controllers/login.controller.js'
import sightingRoutes from './controllers/sighting.controller.js'
import gameRoutes from './controllers/game.controller.js'

import middlewares from './utils/middlewares.js'
import { uploadDir } from './utils/upload.js'

const app = express()

const distDir = path.join(import.meta.dirname, '..', 'dist')

// behind Nginx: trust one proxy hop so req.ip (rate limit) is the real client IP
app.set('trust proxy', 1)

// the CSP allows the Google Fonts loaded by index.html; everything else is same-origin
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:']
    }
  }
}))

// health check for monitoring: before the rate limit so probes don't use up the quota
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// front build: before the rate limit, so loading the page doesn't use up the quota
// hashed assets never change; index.html must be revalidated so a new deploy is picked up
app.use(express.static(distDir, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable')
    } else {
      res.set('Cache-Control', 'no-cache')
    }
  }
}))

// basic global rate limit per IP: 100 requests every 15 minutes
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' },
  // the endpoint tests fire more requests than one window allows
  skip: () => process.env.NODE_ENV === 'test'
}))

app.use(express.json())

app.use(middlewares.requestLogger)

// uploaded photos: served as static files from /uploads (no directory listing, no dotfiles)
// every photo has a unique uuid name, so it can be cached for good
// nosniff: the browser must not reinterpret a file as something other than its served type
app.use('/uploads', express.static(uploadDir, {
  index: false,
  dotfiles: 'ignore',
  maxAge: '30d',
  immutable: true,
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
}))

// the current top changes with every sighting: never serve it from cache
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-cache')
  next()
})

app.use('/api/users', userRoutes)
app.use('/api/login', loginRoutes)
app.use('/api/sightings', sightingRoutes)
app.use('/api', gameRoutes)

// SPA fallback: any other GET returns index.html (never for /api or /uploads)
app.get(/^\/(?!api(\/|$)|uploads(\/|$)).*/, (req, res, next) => {
  res.set('Cache-Control', 'no-cache')
  res.sendFile(path.join(distDir, 'index.html'), (error) => error && next())
})

// central error middleware: must come after the routes
app.use(middlewares.errorHandler)

export default app
