import mongoose from 'mongoose'

const sightingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // uniqueness is enforced by the partial index below
    licensePlate: {
      type: String,
      required: true,
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
    // superseded: a newer plate was approved first, so this one can no longer be the top
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'superseded'],
      default: 'pending',
    },
    decidedAt: Date,
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    rejectReason: {
      type: String,
      maxLength: 300,
    },
  },
  { collection: 'sightings' }
)

// a plate can be alive (pending or approved) only once, but a rejected one can be sent again
// ($in in partialFilterExpression needs MongoDB >= 6.0)
sightingSchema.index(
  { licensePlate: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved'] } } }
)
sightingSchema.index({ status: 1, sortKey: -1 }) // approved top
sightingSchema.index({ status: 1, createdAt: 1 }) // moderation queue
sightingSchema.index({ user: 1, status: 1 }) // pending limit and "my sightings"

export default mongoose.model('Sighting', sightingSchema)
