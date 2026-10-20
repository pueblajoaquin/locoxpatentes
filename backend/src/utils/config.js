import 'dotenv/config'

const PORT = process.env.PORT
const SECRET = process.env.SECRET
const MONGODB_URL = process.env.NODE_ENV === 'test'
  ? process.env.TEST_MONGODB_URL
  : process.env.MONGODB_URL

export default {
  PORT,
  SECRET,
  MONGODB_URL
}
