import mongoose from 'mongoose'

const sightingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    licensePlate: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sortKey: {
      type: String,
      required: true,
      index: true,
    },
    photoPath: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'sightings' }
)

export default mongoose.model('Sighting', sightingSchema)
