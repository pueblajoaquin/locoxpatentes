import logger from './logger.js'
import config from './config.js'
import jwt from 'jsonwebtoken'
import User from '../models/user.model.js'

const requestLogger = (req, res, next) => {
  logger.info(req.method)
  logger.info(req.path)
  // don't log the body of routes that carry passwords
  const sensitive = req.path.startsWith('/api/users') || req.path.startsWith('/api/login')
  logger.info(sensitive ? '[body omitted]' : (req.body || 'without body'))
  next()
}

const tokenExtractor = (req, res, next) => {
  const auth = req.get('authorization')
  if (auth && auth.startsWith('Bearer ')) {
    req.token = auth.replace('Bearer ', '')
  } else {
    req.token = null
  }
  next()
}

const userExtractor = async (req, res, next) => {
  let decodedToken
  try {
    decodedToken = jwt.verify(req.token, config.SECRET)
  } catch {
    return res.status(401).json({ error: 'token missing or invalid' })
  }

  const user = await User.findById(decodedToken.id)
  if (!user) {
    return res.status(401).json({ error: 'user not found' })
  }

  req.user = user
  next()
}

const errorHandler = (error, req, res, next) => {
  logger.error(error.message)

  // multer errors: file type not allowed or size exceeded
  if (error.name === 'MulterError') {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'The image exceeds the 5 MB limit.'
      : 'Image format not allowed. Use JPEG, PNG or WebP.'
    return res.status(400).json({ error: message })
  }

  // validation errors: mongoose (e.g. minLength on username) or our own (e.g. plate type)
  if (error.name === 'ValidationError') {
    return res.status(400).json({ error: error.message })
  }

  // duplicate username (unique index)
  if (error.code === 11000) {
    return res.status(409).json({ error: 'That username already exists.' })
  }

  // errors raised by express/body-parser carry their own 4xx status (e.g. malformed JSON, payload too large)
  if (error.expose && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message })
  }

  return res.status(500).json({ error: 'Internal server error.' })
}

export default {
  requestLogger,
  tokenExtractor,
  userExtractor,
  errorHandler
}
