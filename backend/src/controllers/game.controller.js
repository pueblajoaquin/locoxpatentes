import { Router } from 'express'
import path from 'node:path'
import Sighting from '../models/sighting.model.js'
import User from '../models/user.model.js'
import plateLogic from '../utils/logic.js'

const gameRoutes = Router()

// maps a sighting to the public response format
const toPublic = (s) => ({
  plate: s.licensePlate,
  user: s.user?.username ?? null,
  photoUrl: `/uploads/${path.basename(s.photoPath)}`,
  createdAt: s.createdAt
})

// GET /api/top: the sighting with the highest sortKey
gameRoutes.get('/top', async (req, res, next) => {
  try {
    const top = await Sighting.findOne()
      .sort({ sortKey: -1 })
      .populate('user', 'username')

    if (!top) {
      return res.status(200).json(null)
    }

    return res.status(200).json(toPublic(top))
  } catch (error) {
    next(error)
  }
})

// GET /api/history: from newest to oldest
gameRoutes.get('/history', async (req, res, next) => {
  try {
    const sightings = await Sighting.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'username')

    return res.status(200).json(sightings.map(toPublic))
  } catch (error) {
    next(error)
  }
})

// GET /api/ranking: number of tops per user, highest first
gameRoutes.get('/ranking', async (req, res, next) => {
  try {
    const ranking = await Sighting.aggregate([
      { $group: { _id: '$user', tops: { $sum: 1 } } },
      { $sort: { tops: -1 } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          username: '$user.username',
          tops: 1
        }
      }
    ])

    return res.status(200).json(ranking)
  } catch (error) {
    next(error)
  }
})

// GET /api/ranking/time: total time spent as top per user, highest first
gameRoutes.get('/ranking/time', async (req, res, next) => {
  try {
    const sightings = await Sighting.find({}, 'user createdAt')
      .sort({ createdAt: 1 })
      .lean()

    const ranking = plateLogic.computeTimeRanking(sightings, new Date())

    const users = await User.find({ _id: { $in: ranking.map((r) => r.userId) } }, 'username').lean()
    const names = new Map(users.map((u) => [String(u._id), u.username]))

    return res.status(200).json(ranking.map((r) => ({
      username: names.get(r.userId) ?? null,
      totalMs: r.totalMs,
      isCurrentTop: r.isCurrentTop
    })))
  } catch (error) {
    next(error)
  }
})

export default gameRoutes
