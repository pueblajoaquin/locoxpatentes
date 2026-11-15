import { Router } from 'express'
import mongoose from 'mongoose'

import Sighting from '../models/sighting.model.js'
import middlewares from '../utils/middlewares.js'
import { removeStoredFile } from '../utils/upload.js'
import { sendDecisionEmail } from '../utils/mailer.js'
import { toPublic } from './game.controller.js'

const moderationRoutes = Router()

const MAX_REASON_LENGTH = 300
const QUEUE_LIMIT = 50

// approvals run one at a time (the app is a single process): each one reads the top and then
// replaces it, so two at once would both delete the photo of the same previous top and leave
// the photo of the one that ends up below orphaned on disk
let approvals = Promise.resolve()
const oneAtATime = (task) => {
  const run = approvals.then(task)
  approvals = run.catch(() => {})
  return run
}

moderationRoutes.use(middlewares.tokenExtractor, middlewares.userExtractor, middlewares.requireModerator)

const findApprovedTop = () => Sighting.findOne({ status: 'approved' }).sort({ sortKey: -1 })

// conditional on still being pending: if two moderators decide at once, only one wins.
// Returns the updated sighting (author populated), or null if somebody else decided first
const decide = (id, moderator, fields) =>
  Sighting.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { ...fields, decidedAt: new Date(), decidedBy: moderator._id },
    { returnDocument: 'after' }
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
    const [pending, keys, top] = await Promise.all([
      Sighting.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(QUEUE_LIMIT).populate('user', 'username'),
      // the whole queue, not only the page, oldest first
      Sighting.find({ status: 'pending' }, 'sortKey licensePlate createdAt').sort({ createdAt: 1 }).lean(),
      findApprovedTop()
    ])

    return res.status(200).json({
      currentTop: top?.licensePlate ?? null,
      total: keys.length,
      items: pending.map((s) => {
        const newerThanTop = !top || s.sortKey > top.sortKey
        // same rule as approve: an older plate sent before this one has to be decided first
        const sentBefore = newerThanTop
          ? keys.find((k) => k.createdAt < s.createdAt && k.sortKey < s.sortKey && (!top || k.sortKey > top.sortKey))
          : undefined
        return {
          id: s.id,
          ...toPublic(s),
          isOwn: Boolean(s.user?._id.equals(req.user._id)),
          newerThanTop,
          blockedBy: sentBefore?.licensePlate ?? null,
          // how many other pending sightings approving this one would supersede
          supersedes: newerThanTop ? keys.filter((k) => k.sortKey < s.sortKey).length : 0
        }
      })
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/moderation/:id/approve: the sighting becomes the top
moderationRoutes.post('/:id/approve', async (req, res, next) => {
  try {
    await oneAtATime(async () => {
      const sighting = await findModerable(req, res)
      if (!sighting) return

      // checked again here: another plate may have been approved since it was sent
      const previousTop = await findApprovedTop()
      if (previousTop && sighting.sortKey <= previousTop.sortKey) {
        await supersede(sighting._id, req.user)
        return res.status(409).json({ error: 'superseded', currentTop: previousTop.licensePlate })
      }

      // approving this one would supersede a plate that was sent before it and may be legitimate:
      // that one has to be decided first (plates sent later are superseded below, as they never were the newest)
      const sentBefore = await Sighting.findOne({
        status: 'pending',
        createdAt: { $lt: sighting.createdAt },
        sortKey: { $lt: sighting.sortKey, ...(previousTop && { $gt: previousTop.sortKey }) }
      }).sort({ createdAt: 1 })
      if (sentBefore) {
        return res.status(409).json({ error: 'older pending first', blockedBy: sentBefore.licensePlate })
      }

      const approved = await decide(sighting._id, req.user, { status: 'approved' })
      if (!approved) {
        return res.status(409).json({ error: 'already decided' })
      }

      // the approval is done: the author hears about it even if the cleanup below fails
      notifyAuthor(approved)

      // only the photo of the current top is kept
      if (previousTop) removeStoredFile(previousTop.photoPath)

      // the pending ones that are now older than the top can't be approved anymore
      const outdated = await Sighting.find({ status: 'pending', sortKey: { $lte: approved.sortKey } }, '_id')
      for (const { _id } of outdated) {
        await supersede(_id, req.user)
      }

      return res.status(200).json(toPublic(approved))
    })
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
