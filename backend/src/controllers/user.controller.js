import User from '../models/user.model.js'
import bcrypt from 'bcrypt'
import { Router } from 'express'

const userRoutes = Router()

userRoutes.post('/', async (request, response) => {
  const { username, password } = request.body

  if (!password) {
    return response.status(400).json({ error: 'password is missing' })
  }

  if (typeof password !== 'string') {
    return response.status(400).json({ error: 'password must be a text string' })
  }

  if (password.length < 3) {
    return response.status(400).json({ error: 'password must be at least 3 characters long' })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = new User({
    username,
    passwordHash
  })

  const savedUser = await user.save()

  return response.status(201).json(savedUser)
})

export default userRoutes
