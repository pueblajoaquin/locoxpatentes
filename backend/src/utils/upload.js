import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import path from 'node:path'
import fs from 'node:fs'

// single source of truth: allowed mimetypes and the extension each one gets
const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
}

const uploadDir = path.resolve('uploads')

// create the folder if it does not exist: multer does not create it
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir)
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  // random uuid name; the extension comes from the mimetype, never from the original name
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${EXTENSIONS[file.mimetype]}`)
  }
})

const fileFilter = (req, file, cb) => {
  if (file.mimetype in EXTENSIONS) {
    cb(null, true)
  } else {
    // MulterError so the errorHandler translates it into a 400
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
})

export default upload
