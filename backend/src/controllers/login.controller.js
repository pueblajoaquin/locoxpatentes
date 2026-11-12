import User from '../models/user.model.js'
import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import config from '../utils/config.js'
import middlewares from '../utils/middlewares.js'

const loginRoutes = Router()

loginRoutes.post('', async (req, res) => {
  const { username, password } = req.body

  // bcrypt.compare throws on non-strings: treat them as bad credentials
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'invalid username or password' })
  }

  const user = await User.findOne({ username })
  const correctPassword = user === null
    ? false
    : await bcrypt.compare(password, user.passwordHash)

  if (!correctPassword) {
    return res.status(401).json({ error: 'invalid username or password' })
  }

  // checked after the password so the verification state isn't revealed to whoever doesn't know it
  // (users created before emails existed have none and can still log in)
  if (user.email && !user.emailVerified) {
    return res.status(403).json({ error: 'email not verified' })
  }

  const userForToken = {
    username,
    id: user.id
  }

  const token = jwt.sign(
    userForToken,
    config.SECRET,
    { expiresIn: '7d' }
  )

  res.status(200).json({
    token,
    username: user.username,
    emailVerified: user.emailVerified,
    hasEmail: Boolean(user.email),
    // only for showing or hiding UI: the real check is requireModerator
    isModerator: middlewares.isModerator(user)
  })
})

export default loginRoutes
