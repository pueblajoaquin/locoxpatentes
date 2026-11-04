import crypto from 'node:crypto'

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
export const RESET_TTL_MS = 60 * 60 * 1000

export const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex')

export const createToken = () => {
  const token = crypto.randomBytes(32).toString('hex')
  return { token, hash: hashToken(token) }
}
