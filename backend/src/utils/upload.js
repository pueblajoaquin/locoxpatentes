import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import path from 'node:path'
import fs from 'node:fs'

import config from './config.js'

// single source of truth: allowed mimetypes and the extension each one gets
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
}

// absolute path: does not depend on the directory the process was started from
export const uploadDir = path.join(import.meta.dirname, '..', '..', 'uploads')

// create the folder if it does not exist: multer does not create it
fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  // random uuid name; the extension comes from the mimetype, never from the original name
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${EXTENSIONS[file.mimetype]}`)
  }
})

const ALLOWED_ORIGINAL_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

const fileFilter = (req, file, cb) => {
  // both the declared mimetype and the original extension must be allowed
  const extension = path.extname(file.originalname).toLowerCase()
  if (file.mimetype in EXTENSIONS && ALLOWED_ORIGINAL_EXTENSIONS.includes(extension)) {
    cb(null, true)
  } else {
    // MulterError so the errorHandler translates it into a 400
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 }
})

export default upload
