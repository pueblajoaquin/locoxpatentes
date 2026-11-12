import { Router } from 'express'
import path from 'node:path'

import Sighting from '../models/sighting.model.js'
import User from '../models/user.model.js'
import plateLogic from '../utils/logic.js'
import middlewares from '../utils/middlewares.js'
import upload, { removeUploadedFile } from '../utils/upload.js'
import { sendNewSubmissionEmail } from '../utils/mailer.js'
import config from '../utils/config.js'
import logger from '../utils/logger.js'

const sightingRoutes = Router()

const MAX_PENDING = 3
const MINE_LIMIT = 20

// statuses in which a plate is "alive": it can't be sent again (same filter as the unique index)
const ALIVE = ['pending', 'approved']

const findApprovedTop = () => Sighting.findOne({ status: 'approved' }).sort({ sortKey: -1 })

// mail to the moderators with a verified email, except the author (who can't moderate it anyway)
const notifyModerators = async (sighting, author) => {
  if (config.MODERATORS.size === 0) return
  const moderators = await User.find({
    username: { $in: [...config.MODERATORS] },
    emailVerified: true,
    _id: { $ne: author._id }
  })
  await sendNewSubmissionEmail(moderators, sighting, author.username)
}

// the user comes from the JWT, not from the body
sightingRoutes.post('/', middlewares.tokenExtractor, middlewares.userExtractor, upload.single('photo'), async (req, res, next) => {
  let saved = false
  try {
    // 1. only users with a verified email can play (users without email included)
    if (!req.user.emailVerified) {
      removeUploadedFile(req.file)
      return res.status(403).json({ error: 'email verification required' })
    }

    // 2. required fields present
    const { plate } = req.body
    if (!plate || !String(plate).trim()) {
      removeUploadedFile(req.file)
      return res.status(400).json({ error: 'The license plate is required.' })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'The photo is required.' })
    }

    // 3. valid format after normalizing
    const normalized = plateLogic.normalizePlate(String(plate))
    if (!plateLogic.isValidPlate(normalized)) {
      removeUploadedFile(req.file)
      return res.status(400).json({ error: 'Invalid license plate format. Use the Mercosur format (e.g. AB123CD).' })
    }

    // 4. limit of sightings waiting for moderation per user
    const pending = await Sighting.countDocuments({ user: req.user._id, status: 'pending' })
    if (pending >= MAX_PENDING) {
      removeUploadedFile(req.file)
      return res.status(429).json({ error: 'too many pending sightings' })
    }

    // 5. duplicate plate (check before hitting the unique index); a rejected one can be sent again
    const existing = await Sighting.findOne({ licensePlate: normalized, status: { $in: ALIVE } })
    if (existing) {
      removeUploadedFile(req.file)
      return res.status(409).json({ error: 'That license plate has already been registered.' })
    }

    // 6. compare against the approved top (checked again when a moderator approves it)
    const currentTop = await findApprovedTop()
    if (currentTop && !plateLogic.isNewerThan(normalized, currentTop.licensePlate)) {
      removeUploadedFile(req.file)
      return res.status(422).json({
        error: 'The license plate is not newer than the current top.',
        currentTop: currentTop.licensePlate
      })
    }

    // 7. save it as pending: it doesn't count until a moderator approves it
    const sighting = new Sighting({
      user: req.user._id,
      licensePlate: normalized,
      sortKey: plateLogic.sortKey(normalized),
      photoPath: req.file.path,
      status: 'pending'
    })

    try {
      await sighting.save()
    } catch (error) {
      // two simultaneous requests can both pass the check above:
      // Mongo's unique index saves us with error code 11000
      if (error.code === 11000) {
        removeUploadedFile(req.file)
        return res.status(409).json({ error: 'That license plate has already been registered.' })
      }
      throw error
    }
    saved = true

    // 8. fire-and-forget: the response doesn't wait for the mails
    notifyModerators(sighting, req.user).catch((error) => logger.error(error.message))

    return res.status(202).json({
      plate: sighting.licensePlate,
      status: sighting.status,
      createdAt: sighting.createdAt
    })
  } catch (error) {
    // once saved, the photo belongs to the sighting: don't delete it if only the response failed
    if (!saved) removeUploadedFile(req.file)
    next(error)
  }
})

// GET /api/sightings/mine: the user's latest sightings, newest first, whatever their status
sightingRoutes.get('/mine', middlewares.tokenExtractor, middlewares.userExtractor, async (req, res, next) => {
  try {
    const [sightings, top] = await Promise.all([
      Sighting.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(MINE_LIMIT),
      findApprovedTop()
    ])

    // the photo only exists while the sighting is pending or is the current top
    const hasPhoto = (s) => s.status === 'pending' || (top !== null && s._id.equals(top._id))

    return res.status(200).json(sightings.map((s) => ({
      id: s.id,
      plate: s.licensePlate,
      status: s.status,
      rejectReason: s.rejectReason ?? null,
      createdAt: s.createdAt,
      decidedAt: s.decidedAt ?? null,
      photoUrl: hasPhoto(s) ? `/uploads/${path.basename(s.photoPath)}` : null
    })))
  } catch (error) {
    next(error)
  }
})

export default sightingRoutes
