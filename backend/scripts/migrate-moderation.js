// One-off migration for sighting moderation. Run once: npm run migrate:moderation
// Safe to run again: every step is idempotent.
import dns from 'node:dns'
import mongoose from 'mongoose'

import Sighting from '../src/models/sighting.model.js'
import config from '../src/utils/config.js'

dns.setServers(['1.1.1.1']) // same as index.js (Atlas SRV)

if (!config.MONGODB_URL) {
  console.error('MONGODB_URL must be set')
  process.exit(1)
}

// the model would start building the new indexes on connect, racing with the drop below
mongoose.set('autoIndex', false)

try {
  await mongoose.connect(config.MONGODB_URL)

  // the partial unique index uses $in, which needs MongoDB >= 6.0
  const { version } = await mongoose.connection.db.admin().serverInfo()
  if (Number(version.split('.')[0]) < 6) {
    throw new Error(`MongoDB >= 6.0 is required, found ${version}`)
  }

  // 1. everything that already exists was accepted under the old rules
  const { modifiedCount } = await Sighting.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'approved' } }
  )
  console.log(`sightings marked as approved: ${modifiedCount}`)

  // 2. the old unique index has the same name as the new partial one, so it has to go first
  // (on a second run it is already the partial one and is left alone)
  let indexes = []
  try {
    indexes = await Sighting.collection.indexes()
  } catch (error) {
    if (error.codeName !== 'NamespaceNotFound') throw error // no collection yet: nothing to drop
  }
  const oldIndex = indexes.find(index => index.name === 'licensePlate_1' && !index.partialFilterExpression)
  if (oldIndex) {
    await Sighting.collection.dropIndex('licensePlate_1')
    console.log('dropped old index licensePlate_1')
  } else {
    console.log('old index licensePlate_1 not found, skipping')
  }

  // 3. create the new indexes
  await Sighting.syncIndexes()
  console.log('indexes synced:', (await Sighting.collection.indexes()).map(index => index.name).join(', '))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
