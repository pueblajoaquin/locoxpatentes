import 'dotenv/config'

const PORT = process.env.PORT || 3000
// loopback by default: in production only Nginx talks to the app
const HOST = process.env.HOST || '127.0.0.1'
const SECRET = process.env.SECRET
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5
const MONGODB_URL = process.env.NODE_ENV === 'test'
  ? process.env.TEST_MONGODB_URL
  : process.env.MONGODB_URL

export default {
  PORT,
  HOST,
  SECRET,
  MAX_UPLOAD_MB,
  MONGODB_URL
}
