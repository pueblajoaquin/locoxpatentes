import express from 'express'
import rateLimit from 'express-rate-limit'

import userRoutes from './controllers/user.controller.js'
import loginRoutes from './controllers/login.controller.js'
import sightingRoutes from './controllers/sighting.controller.js'
import gameRoutes from './controllers/game.controller.js'

import middlewares from './utils/middlewares.js'

const app = express()

// front build: before the rate limit, so loading the page doesn't use up the quota
app.use(express.static('dist'))

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

// uploaded photos: served as static files from /uploads
// nosniff: the browser must not reinterpret a file as something other than its served type
app.use('/uploads', express.static('uploads', {
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
}))

app.use('/api/users', userRoutes)
app.use('/api/login', loginRoutes)
app.use('/api/sightings', sightingRoutes)
app.use('/api', gameRoutes)

// central error middleware: must come after the routes
app.use(middlewares.errorHandler)

export default app
