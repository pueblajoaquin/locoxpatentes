import { Router } from 'express'
import mongoose from 'mongoose'

import Sighting from '../models/sighting.model.js'
import middlewares from '../utils/middlewares.js'
import { removeStoredFile } from '../utils/upload.js'
import { sendDecisionEmail } from '../utils/mailer.js'
import { toPublic } from './game.controller.js'

const moderationRoutes = Router()

const MAX_REASON_LENGTH = 300

moderationRoutes.use(middlewares.tokenExtractor, middlewares.userExtractor, middlewares.requireModerator)

const findApprovedTop = () => Sighting.findOne({ status: 'approved' }).sort({ sortKey: -1 })

// conditional on still being pending: if two moderators decide at once, only one wins.
// Returns the updated sighting (author populated), or null if somebody else decided first
const decide = (id, moderator, fields) =>
  Sighting.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { ...fields, decidedAt: new Date(), decidedBy: moderator._id },
    { new: true }
  ).populate('user', 'username email emailVerified')

// fire-and-forget (send never throws): the moderator doesn't wait for the mail
const notifyAuthor = (sighting) => {
  sendDecisionEmail(sighting.user, sighting)
}

// a newer plate was approved first: this one can no longer be the top, so its photo goes too
const supersede = async (id, moderator) => {
  const superseded = await decide(id, moderator, { status: 'superseded' })
  if (superseded) {
    removeStoredFile(superseded.photoPath)
    notifyAuthor(superseded)
  }
}

// common checks of approve / reject. Answers and returns null when the sighting can't be moderated
const findModerable = async (req, res) => {
  const { id } = req.params
  const sighting = mongoose.isValidObjectId(id) ? await Sighting.findById(id) : null
  if (!sighting) {
    res.status(404).json({ error: 'sighting not found' })
    return null
  }
  if (sighting.status !== 'pending') {
    res.status(409).json({ error: 'already decided' })
    return null
  }
  if (sighting.user.equals(req.user._id)) {
    res.status(403).json({ error: 'cannot moderate own sighting' })
    return null
  }
  return sighting
}

// GET /api/moderation/pending: the queue, oldest first (approving in that order supersedes fewer)
moderationRoutes.get('/pending', async (req, res, next) => {
  try {
    const [pending, top] = await Promise.all([
      Sighting.find({ status: 'pending' }).sort({ createdAt: 1 }).populate('user', 'username'),
      findApprovedTop()
    ])

    return res.status(200).json({
      currentTop: top?.licensePlate ?? null,
      items: pending.map((s) => ({
        id: s.id,
        ...toPublic(s),
        isOwn: Boolean(s.user?._id.equals(req.user._id)),
        newerThanTop: !top || s.sortKey > top.sortKey
      }))
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/moderation/:id/approve: the sighting becomes the top
moderationRoutes.post('/:id/approve', async (req, res, next) => {
  try {
    const sighting = await findModerable(req, res)
    if (!sighting) return

    // checked again here: another plate may have been approved since it was sent
    const previousTop = await findApprovedTop()
    if (previousTop && sighting.sortKey <= previousTop.sortKey) {
      await supersede(sighting._id, req.user)
      return res.status(409).json({ error: 'superseded', currentTop: previousTop.licensePlate })
    }

    const approved = await decide(sighting._id, req.user, { status: 'approved' })
    if (!approved) {
      return res.status(409).json({ error: 'already decided' })
    }

    // only the photo of the current top is kept
    if (previousTop) removeStoredFile(previousTop.photoPath)

    // the pending ones that are now older than the top can't be approved anymore
    const outdated = await Sighting.find({ status: 'pending', sortKey: { $lte: approved.sortKey } }, '_id')
    for (const { _id } of outdated) {
      await supersede(_id, req.user)
    }

    notifyAuthor(approved)
    return res.status(200).json(toPublic(approved))
  } catch (error) {
    next(error)
  }
})

// POST /api/moderation/:id/reject: body { reason }
moderationRoutes.post('/:id/reject', async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      return res.status(400).json({ error: `A reject reason of 1 to ${MAX_REASON_LENGTH} characters is required.` })
    }

    const sighting = await findModerable(req, res)
    if (!sighting) return

    const rejected = await decide(sighting._id, req.user, { status: 'rejected', rejectReason: reason })
    if (!rejected) {
      return res.status(409).json({ error: 'already decided' })
    }

    removeStoredFile(rejected.photoPath)
    notifyAuthor(rejected)

    return res.status(200).json({
      id: rejected.id,
      plate: rejected.licensePlate,
      user: rejected.user?.username ?? null,
      status: rejected.status,
      rejectReason: rejected.rejectReason
    })
  } catch (error) {
    next(error)
  }
})

export default moderationRoutes
