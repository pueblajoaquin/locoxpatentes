import dns from 'node:dns'
import mongoose from 'mongoose'

import app from './app.js'
import config from './utils/config.js'
import logger from './utils/logger.js'

dns.setServers(['1.1.1.1'])

// fail at startup instead of at the first login
if (!config.SECRET || !config.MONGODB_URL) {
  logger.error('SECRET and MONGODB_URL must be set')
  process.exit(1)
}

try {
  await mongoose.connect(config.MONGODB_URL)
  logger.info('connected mongodb')
} catch (error) {
  logger.error(error)
  process.exit(1) // no point starting without a database
}

app.listen(config.PORT, config.HOST, () => {
  logger.info(`server on ${config.HOST}:${config.PORT}`)
})
