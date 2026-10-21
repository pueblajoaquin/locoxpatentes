import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'

import Sighting from '../models/sighting.model.js'
import plateLogic from '../utils/logic.js'
import middlewares from '../utils/middlewares.js'
import upload, { uploadDir } from '../utils/upload.js'
import logger from '../utils/logger.js'

const sightingRoutes = Router()

// helper: the photo is already on disk once multer has processed it,
// so if the request is rejected afterwards it has to be deleted
const removeUploadedFile = (file) => {
  if (file?.path) {
    fs.unlink(file.path, () => {}) // best-effort: if it no longer exists, it doesn't matter
  }
}

// same for the photo of a saved sighting that is no longer the top; a missing file is not an error
// (only the basename is used, so a stale absolute path can't point outside uploads)
const removeStoredFile = (photoPath) => {
  fs.promises.unlink(path.join(uploadDir, path.basename(photoPath))).catch((error) => {
    if (error.code !== 'ENOENT') logger.error(error.message)
  })
}

// the user comes from the JWT, not from the body
sightingRoutes.post('/', middlewares.tokenExtractor, middlewares.userExtractor, upload.single('photo'), async (req, res, next) => {
  let saved = false
  try {
    // 1. required fields present
    const { plate } = req.body
    if (!plate || !String(plate).trim()) {
      removeUploadedFile(req.file)
      return res.status(400).json({ error: 'The license plate is required.' })
    }
    if (!req.file) {
      return res.status(400).json({ error: 'The photo is required.' })
    }

    // 2. valid format after normalizing
    const normalized = plateLogic.normalizePlate(String(plate))
    if (!plateLogic.isValidPlate(normalized)) {
      removeUploadedFile(req.file)
      return res.status(400).json({ error: 'Invalid license plate format. Use the Mercosur format (e.g. AB123CD).' })
    }

    // 3. duplicate plate (check before hitting the unique index)
    const existing = await Sighting.findOne({ licensePlate: normalized })
    if (existing) {
      removeUploadedFile(req.file)
      return res.status(409).json({ error: 'That license plate has already been registered.' })
    }

    // 4. compare against the current top
    const currentTop = await Sighting.findOne().sort({ sortKey: -1 })
    if (currentTop && !plateLogic.isNewerThan(normalized, currentTop.licensePlate)) {
      removeUploadedFile(req.file)
      return res.status(422).json({
        error: 'The license plate is not newer than the current top.',
        currentTop: currentTop.licensePlate
      })
    }

    // 5. save the sighting
    const sighting = new Sighting({
      user: req.user._id,
      licensePlate: normalized,
      sortKey: plateLogic.sortKey(normalized),
      photoPath: req.file.path
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

    // only the photo of the current top is kept: the previous one is no longer needed
    if (currentTop) removeStoredFile(currentTop.photoPath)

    const populated = await sighting.populate('user', 'username')

    return res.status(201).json({
      plate: populated.licensePlate,
      user: populated.user.username,
      photoUrl: `/uploads/${path.basename(populated.photoPath)}`,
      createdAt: populated.createdAt
    })
  } catch (error) {
    // once saved, the photo belongs to the sighting: don't delete it if only the response failed
    if (!saved) removeUploadedFile(req.file)
    next(error)
  }
})

export default sightingRoutes
