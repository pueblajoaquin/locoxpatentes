import { test, describe, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import supertest from 'supertest'
import bcrypt from 'bcrypt'

import app from '../src/app.js'
import config from '../src/utils/config.js'
import User from '../src/models/user.model.js'
import Sighting from '../src/models/sighting.model.js'
import { sentMails, clearSentMails } from '../src/utils/mailer.js'

dns.setServers(['1.1.1.1'])

const api = supertest(app)
const uploadDir = path.resolve('uploads')

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

const listUploads = () => new Set(fs.readdirSync(uploadDir))

const register = (username = 'tester', password = 'secret', email = `${username}@test.com`) =>
  api.post('/api/users').send({ username, password, email })

// token of the last mail sent to that address, read from its link (?verify= or ?reset=)
const tokenFromMail = (to, param) => {
  const mail = sentMails.findLast((m) => m.to === to)
  assert.ok(mail, `no mail sent to ${to}`)
  const match = mail.text.match(new RegExp(`[?&]${param}=([0-9a-f]+)`))
  assert.ok(match, `no ${param} link in the mail`)
  return match[1]
}

const verify = (token) => api.post('/api/users/verify-email').send({ token })

// registers the user and verifies the email with the token from the mail
const registerVerified = async (username = 'tester', password = 'secret') => {
  const email = `${username}@test.com`
  const res = await register(username, password, email)
  assert.equal(res.status, 201)
  const verified = await verify(tokenFromMail(email, 'verify'))
  assert.equal(verified.status, 200)
}

const login = (username = 'tester', password = 'secret') =>
  api.post('/api/login').send({ username, password })

// registers and verifies the user, logs in and returns the JWT
const tokenFor = async (username = 'tester', password = 'secret') => {
  await registerVerified(username, password)
  const res = await login(username, password)
  return res.body.token
}

// user created before emails existed: no email at all
const createLegacyUser = async (username = 'legacy', password = 'secret') =>
  User.create({ username, passwordHash: await bcrypt.hash(password, 10) })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  clearSentMails()
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
  test('creates an unverified user without exposing hashes or a session token', async () => {
    const res = await register()
    assert.equal(res.status, 201)
    assert.equal(res.body.username, 'tester')
    assert.equal(res.body.email, 'tester@test.com')
    assert.equal(res.body.emailVerified, false)
    assert.equal(res.body.passwordHash, undefined)
    assert.equal(res.body.verifyTokenHash, undefined)
    assert.equal(res.body.token, undefined)
  })

  test('sends a verification mail and stores only the token hash', async () => {
    await register('tester', 'secret', '  Tester@Test.COM ')
    assert.equal(sentMails.length, 1)
    assert.equal(sentMails[0].to, 'tester@test.com') // normalized
    const token = tokenFromMail('tester@test.com', 'verify')
    const user = await User.findOne({ username: 'tester' })
    assert.notEqual(user.verifyTokenHash, token)
    assert.ok(user.verifyTokenExpires > new Date())
  })

  test('rejects a missing or invalid email with 400', async () => {
    for (const email of [undefined, '', 'not-an-email', 'a@b', 'a b@c.com', 123]) {
      const res = await api.post('/api/users').send({ username: 'tester', password: 'secret', email })
      assert.equal(res.status, 400, String(email))
    }
    assert.equal(sentMails.length, 0)
  })

  test('rejects a duplicated username with 409', async () => {
    await register()
    const res = await register('tester', 'secret', 'other@test.com')
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'That username already exists.')
  })

  test('rejects a duplicated email (case-insensitive) with 409', async () => {
    await register('alice', 'secret', 'same@test.com')
    const res = await register('bob', 'secret', 'SAME@test.com')
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'That email is already registered.')
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

describe('POST /api/users/verify-email', () => {
  test('verifies the email with the token from the mail', async () => {
    await register()
    const res = await verify(tokenFromMail('tester@test.com', 'verify'))
    assert.equal(res.status, 200)
    const user = await User.findOne({ username: 'tester' })
    assert.equal(user.emailVerified, true)
    assert.equal(user.verifyTokenHash, undefined)
  })

  test('rejects an unknown, missing or non-string token with 400', async () => {
    await register()
    for (const token of ['deadbeef', undefined, '', { $ne: null }, 123]) {
      const res = await verify(token)
      assert.equal(res.status, 400, JSON.stringify(token))
      assert.equal(res.body.error, 'invalid or expired token')
    }
    assert.equal((await User.findOne({ username: 'tester' })).emailVerified, false)
  })

  test('rejects an expired token with 400', async () => {
    await register()
    await User.updateOne({ username: 'tester' }, { verifyTokenExpires: new Date(Date.now() - 1000) })
    const res = await verify(tokenFromMail('tester@test.com', 'verify'))
    assert.equal(res.status, 400)
  })

  test('a token works only once', async () => {
    await register()
    const token = tokenFromMail('tester@test.com', 'verify')
    assert.equal((await verify(token)).status, 200)
    assert.equal((await verify(token)).status, 400)
  })
})

describe('POST /api/users/resend-verification', () => {
  const resend = (email) => api.post('/api/users/resend-verification').send({ email })

  test('sends a new token that replaces the previous one', async () => {
    await register()
    const first = tokenFromMail('tester@test.com', 'verify')
    const res = await resend('TESTER@test.com')
    assert.equal(res.status, 200)
    assert.equal(sentMails.length, 2)
    const second = tokenFromMail('tester@test.com', 'verify')
    assert.notEqual(first, second)
    assert.equal((await verify(first)).status, 400)
    assert.equal((await verify(second)).status, 200)
  })

  test('answers the same for unknown or already verified emails, without sending', async () => {
    await registerVerified()
    clearSentMails()
    const verified = await resend('tester@test.com')
    const unknown = await resend('ghost@test.com')
    const invalid = await resend({ $ne: null })
    assert.equal(verified.status, 200)
    assert.equal(unknown.status, 200)
    assert.equal(invalid.status, 200)
    assert.deepEqual(unknown.body, verified.body)
    assert.equal(sentMails.length, 0)
  })
})

describe('POST /api/users/forgot-password and reset-password', () => {
  const forgot = (email) => api.post('/api/users/forgot-password').send({ email })
  const reset = (token, password) => api.post('/api/users/reset-password').send({ token, password })

  test('answers the same for unknown or unverified emails, without sending', async () => {
    await register()
    clearSentMails()
    const unverified = await forgot('tester@test.com')
    const unknown = await forgot('ghost@test.com')
    assert.equal(unverified.status, 200)
    assert.equal(unknown.status, 200)
    assert.deepEqual(unknown.body, unverified.body)
    assert.equal(sentMails.length, 0)
  })

  test('sends a reset link that changes the password', async () => {
    await registerVerified()
    const res = await forgot('tester@test.com')
    assert.equal(res.status, 200)
    const token = tokenFromMail('tester@test.com', 'reset')

    assert.equal((await reset(token, 'newpass')).status, 200)
    assert.equal((await login('tester', 'newpass')).status, 200)
    assert.equal((await login('tester', 'secret')).status, 401)
  })

  test('a reset token works only once', async () => {
    await registerVerified()
    await forgot('tester@test.com')
    const token = tokenFromMail('tester@test.com', 'reset')
    assert.equal((await reset(token, 'newpass')).status, 200)
    assert.equal((await reset(token, 'other')).status, 400)
  })

  test('rejects an expired token with 400', async () => {
    await registerVerified()
    await forgot('tester@test.com')
    await User.updateOne({ username: 'tester' }, { resetTokenExpires: new Date(Date.now() - 1000) })
    const res = await reset(tokenFromMail('tester@test.com', 'reset'), 'newpass')
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid or expired token')
  })

  test('rejects an invalid password with 400 and keeps the token usable', async () => {
    await registerVerified()
    await forgot('tester@test.com')
    const token = tokenFromMail('tester@test.com', 'reset')
    for (const password of [undefined, 'ab', 12345]) {
      assert.equal((await reset(token, password)).status, 400, String(password))
    }
    assert.equal((await reset(token, 'newpass')).status, 200)
  })
})

describe('PUT /api/users/me/email', () => {
  const setEmail = (token, email) => {
    let req = api.put('/api/users/me/email')
    if (token) req = req.set('Authorization', `Bearer ${token}`)
    return req.send({ email })
  }

  test('requires a valid token', async () => {
    const res = await setEmail(null, 'legacy@test.com')
    assert.equal(res.status, 401)
  })

  test('lets a legacy user add an email, unverified, and sends the mail', async () => {
    await createLegacyUser()
    const { body } = await login('legacy')
    assert.equal(body.hasEmail, false)

    const res = await setEmail(body.token, 'Legacy@Test.com')
    assert.equal(res.status, 200)
    assert.equal(res.body.email, 'legacy@test.com')
    assert.equal(res.body.emailVerified, false)
    assert.equal(res.body.verifyTokenHash, undefined)

    assert.equal((await verify(tokenFromMail('legacy@test.com', 'verify'))).status, 200)
    const user = await User.findOne({ username: 'legacy' })
    assert.equal(user.emailVerified, true)
  })

  test('rejects an invalid email with 400 and a taken one with 409', async () => {
    await register('alice', 'secret', 'taken@test.com')
    await createLegacyUser()
    const { body } = await login('legacy')
    const invalid = await setEmail(body.token, 'nope')
    const taken = await setEmail(body.token, 'taken@test.com')
    assert.equal(invalid.status, 400)
    assert.equal(taken.status, 409)
    assert.equal(taken.body.error, 'That email is already registered.')
  })
})

describe('POST /api/login', () => {
  test('returns a token, the username and the email state on valid credentials', async () => {
    await registerVerified()
    const res = await login()
    assert.equal(res.status, 200)
    assert.equal(res.body.username, 'tester')
    assert.equal(res.body.emailVerified, true)
    assert.equal(res.body.hasEmail, true)
    assert.ok(res.body.token)
  })

  test('answers 403 with the right password while the email is unverified', async () => {
    await register()
    const unverified = await login()
    const wrongPassword = await login('tester', 'nope')
    assert.equal(unverified.status, 403)
    assert.equal(unverified.body.error, 'email not verified')
    assert.equal(unverified.body.token, undefined)
    // without the password the verification state is not revealed
    assert.equal(wrongPassword.status, 401)
  })

  test('lets a legacy user without email log in', async () => {
    await createLegacyUser()
    const res = await login('legacy')
    assert.equal(res.status, 200)
    assert.equal(res.body.hasEmail, false)
    assert.equal(res.body.emailVerified, false)
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

  test('rejects users without a verified email with 403 and deletes the photo', async () => {
    await createLegacyUser()
    const { body } = await login('legacy')
    const res = await postSighting(body.token, 'AB123CD')
    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'email verification required')
    await wait(100) // fs.unlink is fire-and-forget
    assert.deepEqual(listUploads(), uploadsBefore)
    assert.equal(await Sighting.countDocuments(), 0)
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

  test('advances the last letters first, then the digits', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AA000AB')
    const older = await postSighting(token, 'AA000AA')
    const newer = await postSighting(token, 'AA001AA')
    assert.equal(older.status, 422)
    assert.equal(newer.status, 201)
  })

  test('deletes the uploaded photo when the sighting is rejected', async () => {
    const token = await tokenFor()
    await postSighting(token, 'AB123CD')
    const afterFirst = listUploads()
    await postSighting(token, 'AA123CD') // 422
    await postSighting(token, 'AB123CD') // 409
    await postSighting(token, 'ABC123') // 400
    // fs.unlink is fire-and-forget: give it a moment
    await wait(100)
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
  test('rejects a disallowed original extension even with an image mimetype', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'AB123CD', {
      buffer: Buffer.from('<script>alert(1)</script>'),
      filename: 'evil.html',
      contentType: 'image/png'
    })
    assert.equal(res.status, 400)
  })

  test('stores the file under a server-generated name and serves it with nosniff', async () => {
    const token = await tokenFor()
    const res = await postSighting(token, 'AB123CD', {
      filename: '../../evil name.PNG'
    })
    assert.equal(res.status, 201)
    assert.doesNotMatch(res.body.photoUrl, /evil/)
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
