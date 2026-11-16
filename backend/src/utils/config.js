import 'dotenv/config'

const PORT = process.env.PORT || 3000
// loopback by default: in production only Nginx talks to the app
const HOST = process.env.HOST || '127.0.0.1'
const SECRET = process.env.SECRET
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 5
const MONGODB_URL = process.env.NODE_ENV === 'test'
  ? process.env.TEST_MONGODB_URL
  : process.env.MONGODB_URL

const MAIL_USER = process.env.MAIL_USER
const MAIL_PASS = process.env.MAIL_PASS
const MAIL_FROM = process.env.MAIL_FROM || MAIL_USER
// base of the links sent by mail (verify / reset)
const APP_URL = process.env.APP_URL

// usernames (case-sensitive, comma-separated) allowed to moderate sightings
const MODERATORS = new Set(
  (process.env.MODERATORS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
)

export default {
  PORT,
  HOST,
  SECRET,
  MAX_UPLOAD_MB,
  MONGODB_URL,
  MAIL_USER,
  MAIL_PASS,
  MAIL_FROM,
  APP_URL,
  MODERATORS
}
