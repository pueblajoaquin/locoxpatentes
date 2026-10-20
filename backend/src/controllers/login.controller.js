import User from '../models/user.model.js'
import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import config from '../utils/config.js'

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
    username: user.username
  })
})

export default loginRoutes
