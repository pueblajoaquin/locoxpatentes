import User, { EMAIL_PATTERN } from '../models/user.model.js'
import bcrypt from 'bcrypt'
import { Router } from 'express'

import middlewares from '../utils/middlewares.js'
import { createToken, hashToken, VERIFY_TTL_MS, RESET_TTL_MS } from '../utils/tokens.js'
import { sendVerificationEmail, sendResetEmail } from '../utils/mailer.js'

const userRoutes = Router()

// shared by register and reset-password: returns the error message, or null if valid
const validatePassword = (password) => {
  if (!password) return 'password is missing'
  if (typeof password !== 'string') return 'password must be a text string'
  if (password.length < 3) return 'password must be at least 3 characters long'
  return null
}

// returns the error message, or null if valid
const validateEmail = (email) => {
  if (!email) return 'email is missing'
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) return 'invalid email'
  return null
}

const normalizeEmail = (email) => email.trim().toLowerCase()

// lookups by email from the body: anything that isn't a string simply matches nobody
const findByEmail = (email) =>
  typeof email === 'string' ? User.findOne({ email: normalizeEmail(email) }) : null

// a new token replaces the previous one: only one active token per kind
const setVerifyToken = (user) => {
  const { token, hash } = createToken()
  user.verifyTokenHash = hash
  user.verifyTokenExpires = new Date(Date.now() + VERIFY_TTL_MS)
  return token
}

// finds the user holding a non-expired token of the given kind ('verify' or 'reset')
const findByToken = (kind, token) => {
  if (typeof token !== 'string' || !token) return null
  return User.findOne({
    [`${kind}TokenHash`]: hashToken(token),
    [`${kind}TokenExpires`]: { $gt: new Date() }
  })
}

const clearTokens = (user) => {
  user.verifyTokenHash = undefined
  user.verifyTokenExpires = undefined
  user.resetTokenHash = undefined
  user.resetTokenExpires = undefined
}

const GENERIC_RESEND = { message: 'If the email is registered and pending verification, a new link was sent.' }
const GENERIC_FORGOT = { message: 'If the email is registered, a reset link was sent.' }

// POST /api/users: registers and sends the verification mail (no session until verified)
userRoutes.post('/', async (request, response) => {
  const { username, password, email } = request.body

  const passwordError = validatePassword(password)
  if (passwordError) {
    return response.status(400).json({ error: passwordError })
  }

  const emailError = validateEmail(email)
  if (emailError) {
    return response.status(400).json({ error: emailError })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = new User({
    username,
    passwordHash,
    email: normalizeEmail(email),
    emailVerified: false
  })
  const token = setVerifyToken(user)

  // duplicated username/email (11000) and schema errors go to the errorHandler
  const savedUser = await user.save()

  // a failed mail doesn't undo the registration: the user can ask for a resend
  await sendVerificationEmail(savedUser, token)

  return response.status(201).json(savedUser)
})

// POST /api/users/verify-email { token }
userRoutes.post('/verify-email', async (request, response) => {
  const user = await findByToken('verify', request.body.token)
  if (!user) {
    return response.status(400).json({ error: 'invalid or expired token' })
  }

  user.emailVerified = true
  user.verifyTokenHash = undefined
  user.verifyTokenExpires = undefined
  await user.save()

  return response.status(200).json({ message: 'email verified' })
})

// POST /api/users/resend-verification { email }: same answer whether or not the email exists
userRoutes.post('/resend-verification', async (request, response) => {
  const user = await findByEmail(request.body.email)

  if (user && !user.emailVerified) {
    const token = setVerifyToken(user)
    await user.save()
    await sendVerificationEmail(user, token)
  }

  return response.status(200).json(GENERIC_RESEND)
})

// POST /api/users/forgot-password { email }: same answer whether or not the email exists
userRoutes.post('/forgot-password', async (request, response) => {
  const user = await findByEmail(request.body.email)

  // only verified emails: otherwise the reset link would prove control of an unverified address
  if (user && user.emailVerified) {
    const { token, hash } = createToken()
    user.resetTokenHash = hash
    user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS)
    await user.save()
    await sendResetEmail(user, token)
  }

  return response.status(200).json(GENERIC_FORGOT)
})

// POST /api/users/reset-password { token, password }
userRoutes.post('/reset-password', async (request, response) => {
  const { token, password } = request.body

  const passwordError = validatePassword(password)
  if (passwordError) {
    return response.status(400).json({ error: passwordError })
  }

  const user = await findByToken('reset', token)
  if (!user) {
    return response.status(400).json({ error: 'invalid or expired token' })
  }

  user.passwordHash = await bcrypt.hash(password, 10)
  // reaching the link proves control of the mailbox
  user.emailVerified = true
  clearTokens(user)
  await user.save()

  return response.status(200).json({ message: 'password updated' })
})

// PUT /api/users/me/email { email }: sets (or replaces) the email of the logged-in user
userRoutes.put('/me/email', middlewares.tokenExtractor, middlewares.userExtractor, async (request, response) => {
  const { email } = request.body

  const emailError = validateEmail(email)
  if (emailError) {
    return response.status(400).json({ error: emailError })
  }

  const user = request.user
  user.email = normalizeEmail(email)
  user.emailVerified = false
  // a pending reset link was sent to the previous address: drop it
  clearTokens(user)
  const token = setVerifyToken(user)

  // an email already taken by someone else: 11000 -> 409 in the errorHandler
  await user.save()
  await sendVerificationEmail(user, token)

  return response.status(200).json(user)
})

export default userRoutes
