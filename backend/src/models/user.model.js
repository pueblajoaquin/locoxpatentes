import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minLength: 3
    },
    passwordHash: {
      type: String,
      required: true
    },
    // Optional: users created before email verification have none (hence sparse).
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email']
    },
    emailVerified: {
      type: Boolean,
      default: false
    },
    // Only hashes are stored; the plain token lives in memory and in the email.
    verifyTokenHash: { type: String, index: true, sparse: true },
    verifyTokenExpires: Date,
    resetTokenHash: { type: String, index: true, sparse: true },
    resetTokenExpires: Date,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'users' }
)

userSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    delete returnedObject.passwordHash
    delete returnedObject.verifyTokenHash
    delete returnedObject.verifyTokenExpires
    delete returnedObject.resetTokenHash
    delete returnedObject.resetTokenExpires
  }
})

export default mongoose.model('User', userSchema)
