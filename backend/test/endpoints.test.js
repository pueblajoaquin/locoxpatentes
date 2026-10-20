import { test, describe, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import supertest from 'supertest'

import app from '../src/app.js'
import config from '../src/utils/config.js'
import User from '../src/models/user.model.js'
import Sighting from '../src/models/sighting.model.js'

dns.setServers(['1.1.1.1'])

const api = supertest(app)
const uploadDir = path.resolve('uploads')

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

const listUploads = () => new Set(fs.readdirSync(uploadDir))

const register = (username = 'tester', password = 'secret') =>
  api.post('/api/users').send({ username, password })

// registers the user (if needed), logs in and returns the JWT
const tokenFor = async (username = 'tester', password = 'secret') => {
  await register(username, password)
  const res = await api.post('/api/login').send({ username, password })
  return res.body.token
}

const postSighting = (token, plate, { buffer = PNG, filename = 'photo.png', contentType = 'image/png' } = {}) => {
  let req = api.post('/api/sightings')
  if (token) req = req.set('Authorization', `Bearer ${token}`)
  if (plate !== undefined) req = req.field('plate', plate)
  if (buffer) req = req.attach('photo', buffer, { filename, contentType })
  return req
}

let uploadsBefore

before(async () => {
  // these tests wipe the collections: never run them against the real database
  if (!process.env.TEST_MONGODB_URL || process.env.TEST_MONGODB_URL === process.env.MONGODB_URL) {
    throw new Error('TEST_MONGODB_URL must be set and different from MONGODB_URL')
  }
  assert.equal(process.env.NODE_ENV, 'test')
  await mongoose.connect(config.MONGODB_URL)
})

beforeEach(async () => {
  await User.deleteMany({})
  await Sighting.deleteMany({})
  uploadsBefore = listUploads()
})

// remove the photos created by the test
afterEach(() => {
  for (const file of listUploads()) {
    if (!uploadsBefore.has(file)) fs.unlinkSync(path.join(uploadDir, file))
  }
})

after(async () => {
  await mongoose.connection.close()
})

describe('POST /api/users', () => {
  test('creates a user without exposing the password hash', async () => {
    const res = await register()
    assert.equal(res.status, 201)
    assert.equal(res.body.username, 'tester')
    assert.equal(res.body.passwordHash, undefined)
  })

  test('rejects a duplicated username with 409', async () => {
    await register()
    const res = await register()
    assert.equal(res.status, 409)
  })

  test('rejects a missing, short or non-string password with 400', async () => {
    for (const password of [undefined, 'ab', 12345]) {
      // posted directly: register() would replace an undefined password with its default
      const res = await api.post('/api/users').send({ username: 'tester', password })
      assert.equal(res.status, 400, String(password))
    }
  })

  test('rejects a short username with 400', async () => {
    const res = await register('ab', 'secret')
    assert.equal(res.status, 400)
  })
})

describe('POST /api/login', () => {
  test('returns a token and the username on valid credentials', async () => {
    await register()
    const res = await api.post('/api/login').send({ username: 'tester', password: 'secret' })
    assert.equal(res.status, 200)
    assert.equal(res.body.username, 'tester')
    assert.ok(res.body.token)
  })

  test('answers 401 on a wrong password or unknown user', async () => {
    await register()
    const wrongPassword = await api.post('/api/login').send({ username: 'tester', password: 'nope' })
    const unknownUser = await api.post('/api/login').send({ username: 'ghost', password: 'secret' })
    assert.equal(wrongPassword.status, 401)
    assert.equal(unknownUser.status, 401)
  })

  test('answers 401 (not 500) on missing or non-string credentials', async () => {
    const empty = await api.post('/api/login').send({})
    const numeric = await api.post('/api/login').send({ username: 'tester', password: 123 })
    assert.equal(empty.status, 401)
    assert.equal(numeric.status, 401)
  })
})

describe('POST /api/sightings', () => {
  test('requires a valid token', async () => {
    const noToken = await postSighting(null, 'AB123CD')
    const badToken = await postSighting('not-a-token', 'AB123CD')
    assert.equal(noToken.status, 401)
    assert.equal(badToken.status, 401)
  })

  test('rejects a missing plate or photo with 400', async () => {
    const token = await tokenFor()
    const noPlate = await postSighting(token, undefined)
    const noPhoto = await postSighting(token, 'AB123CD', { buffer: null })
    assert.equal(noPlate.status, 400)
    assert.equal(noPhoto.status, 400)
  })

  test('rejects an invalid plate format with 400', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'ABC123')
    assert.equal(res.status, 400)
  })

  test('rejects a non-image file with 400', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'AB123CD', {
      buffer: Buffer.from('<h1>hi</h1>'),
      filename: 'page.html',
      contentType: 'text/html'
    })
    assert.equal(res.status, 400)
  })

  test('accepts a valid sighting, normalizing the plate', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'ab 123-cd')
    assert.equal(res.status, 201)
    assert.equal(res.body.plate, 'AB123CD')
    assert.equal(res.body.user, 'tester')
    assert.match(res.body.photoUrl, /^\/uploads\/.+\.png$/)
  })

  test('rejects a duplicated plate with 409', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    const res = await postSighting(token, 'AB123CD')
    assert.equal(res.status, 409)
  })

  test('rejects a plate that is not newer than the top with 422', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    const res = await postSighting(token, 'AA123CD')
    assert.equal(res.status, 422)
    assert.equal(res.body.currentTop, 'AB123CD')
  })

  test('accepts a newer plate', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    const res = await postSighting(token, 'AC123CD')
    assert.equal(res.status, 201)
  })

  test('deletes the uploaded photo when the sighting is rejected', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    const afterFirst = listUploads()
    await postSighting(token, 'AA123CD') // 422
    await postSighting(token, 'AB123CD') // 409
    await postSighting(token, 'ABC123') // 400
    // fs.unlink is fire-and-forget: give it a moment
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(listUploads(), afterFirst)
  })
})

describe('malformed requests', () => {
  test('malformed JSON answers 400, not 500', async () => {
    const res = await api.post('/api/login').set('Content-Type', 'application/json').send('{bad')
    assert.equal(res.status, 400)
  })
})

describe('GET /api/top, /api/history and /api/ranking', () => {
  test('are empty when there are no sightings', async () => {
    const top = await api.get('/api/top')
    const history = await api.get('/api/history')
    const ranking = await api.get('/api/ranking')
    assert.equal(top.status, 200)
    assert.equal(top.body, null)
    assert.deepEqual(history.body, [])
    assert.deepEqual(ranking.body, [])
  })

  test('/top returns the newest plate', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')
    const res = await api.get('/api/top')
    assert.equal(res.body.plate, 'AC123CD')
    assert.equal(res.body.user, 'tester')
  })

  test('/history lists newest first', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')
    const res = await api.get('/api/history')
    assert.deepEqual(res.body.map((s) => s.plate), ['AC123CD', 'AB123CD'])
  })

  test('/ranking counts sightings per user, highest first', async () => {
    const alice = await tokenFor('alice')
    const bob = await tokenFor('bob')
    await postSighting(alice, 'AB123CD')
    await postSighting(bob, 'AC123CD')
    await postSighting(bob, 'AD123CD')
    const res = await api.get('/api/ranking')
    assert.deepEqual(res.body, [
      { username: 'bob', tops: 2 },
      { username: 'alice', tops: 1 }
    ])
  })
})

describe('GET /uploads', () => {
  test('stores the file by mimetype, ignoring a malicious original name, and serves it with nosniff', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'AB123CD', {
      buffer: Buffer.from('<script>alert(1)</script>'),
      filename: 'evil.html',
      contentType: 'image/png'
    })
    assert.equal(res.status, 201)
    assert.match(res.body.photoUrl, /\.png$/)

    const file = await api.get(res.body.photoUrl)
    assert.equal(file.status, 200)
    assert.match(file.headers['content-type'], /image\/png/)
    assert.equal(file.headers['x-content-type-options'], 'nosniff')
  })
})

describe('GET /api/ranking/time', () => {
  test('is empty when there are no sightings', async () => {
    const res = await api.get('/api/ranking/time')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, [])
  })

  test('adds up the time each user spent as top, flagging the current top', async () => {
    const alice = await User.create({ username: 'alice', passwordHash: 'x' })
    const bob = await User.create({ username: 'bob', passwordHash: 'x' })
    const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000)
    const sighting = (user, licensePlate, createdAt) =>
      ({ user: user._id, licensePlate, sortKey: licensePlate, photoPath: 'x.png', createdAt })

    // alice: 10h -> 7h ago (3h); bob: 7h -> 2h ago (5h); alice again: 2h ago -> now (2h)
    await Sighting.create([
      sighting(alice, 'AA111AA', hoursAgo(10)),
      sighting(bob, 'AB111AA', hoursAgo(7)),
      sighting(alice, 'AC111AA', hoursAgo(2))
    ])

    const res = await api.get('/api/ranking/time')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.map((r) => r.username), ['alice', 'bob'])
    assert.deepEqual(res.body.map((r) => r.isCurrentTop), [true, false])

    const hours = (ms) => Math.round(ms / 3600000)
    assert.equal(hours(res.body[0].totalMs), 5) // alice: 3h + 2h
    assert.equal(hours(res.body[1].totalMs), 5) // bob: 5h
  })
})
