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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD = 'secret'
const emailOf = (username) => `${username}@test.com`

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// a valid registration body; any field can be overridden (undefined drops it from the JSON)
const userData = (overrides = {}) => {
  const username = overrides.username ?? 'tester'
  return { username, password: PASSWORD, email: emailOf(username), ...overrides }
}

// ---------------------------------------------------------------------------
// Request helpers: one per endpoint
// ---------------------------------------------------------------------------

const withAuth = (req, token) => (token ? req.set('Authorization', `Bearer ${token}`) : req)

const register = (overrides) => api.post('/api/users').send(userData(overrides))
const verifyEmail = (token) => api.post('/api/users/verify-email').send({ token })
const resendVerification = (email) => api.post('/api/users/resend-verification').send({ email })
const forgotPassword = (email) => api.post('/api/users/forgot-password').send({ email })
const resetPassword = (token, password) => api.post('/api/users/reset-password').send({ token, password })
const setEmail = (token, email) => withAuth(api.put('/api/users/me/email'), token).send({ email })
const login = (username = 'tester', password = PASSWORD) => api.post('/api/login').send({ username, password })

const postSighting = (token, plate, { buffer = PNG, filename = 'photo.png', contentType = 'image/png' } = {}) => {
  let req = withAuth(api.post('/api/sightings'), token)
  if (plate !== undefined) req = req.field('plate', plate)
  if (buffer) req = req.attach('photo', buffer, { filename, contentType })
  return req
}

// ---------------------------------------------------------------------------
// Mail helpers: in tests the mailer keeps every mail in sentMails
// ---------------------------------------------------------------------------

// token from the link (?verify= or ?reset=) of the last mail sent to that address
const tokenFromMail = (email, param) => {
  const mail = sentMails.findLast((m) => m.to === email)
  assert.ok(mail, `no mail sent to ${email}`)
  const match = mail.text.match(new RegExp(`[?&]${param}=([0-9a-f]+)`))
  assert.ok(match, `no ${param} link in the mail to ${email}`)
  return match[1]
}

const verifyTokenFor = (username = 'tester') => tokenFromMail(emailOf(username), 'verify')
const resetTokenFor = (username = 'tester') => tokenFromMail(emailOf(username), 'reset')

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

// registers the user and verifies the email with the token from the mail
const registerVerified = async (username = 'tester') => {
  assert.equal((await register({ username })).status, 201)
  assert.equal((await verifyEmail(verifyTokenFor(username))).status, 200)
}

// registers and verifies the user, logs in and returns the JWT
const loginAsVerified = async (username = 'tester') => {
  await registerVerified(username)
  return (await login(username)).body.token
}

// user created before emails existed: no email at all
const createLegacyUser = async (username = 'legacy') =>
  User.create({ username, passwordHash: await bcrypt.hash(PASSWORD, 10) })

const loginAsLegacy = async () => {
  await createLegacyUser()
  return (await login('legacy')).body.token
}

// verified user that asked for a password reset: returns the token from the mail
const requestReset = async (username = 'tester') => {
  await registerVerified(username)
  await forgotPassword(emailOf(username))
  return resetTokenFor(username)
}

// kind: 'verify' or 'reset'
const expireToken = (kind, username = 'tester') =>
  User.updateOne({ username }, { [`${kind}TokenExpires`]: new Date(Date.now() - 1000) })

const findUser = (username = 'tester') => User.findOne({ username })

const listUploads = () => new Set(fs.readdirSync(uploadDir))

// rejected photos are removed with a fire-and-forget fs.unlink: give it a moment
const waitForUnlink = () => new Promise((resolve) => setTimeout(resolve, 100))

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Registration and email verification
// ---------------------------------------------------------------------------

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

  test('sends a verification mail to the normalized email and stores only the token hash', async () => {
    await register({ email: '  Tester@Test.COM ' })

    assert.equal(sentMails.length, 1)
    assert.equal(sentMails[0].to, 'tester@test.com')

    const user = await findUser()
    assert.notEqual(user.verifyTokenHash, verifyTokenFor())
    assert.ok(user.verifyTokenExpires > new Date())
  })

  test('rejects a missing or invalid email with 400, without sending mail', async () => {
    for (const email of [undefined, '', 'not-an-email', 'a@b', 'a b@c.com', 123]) {
      const res = await register({ email })
      assert.equal(res.status, 400, String(email))
    }
    assert.equal(sentMails.length, 0)
  })

  test('rejects a missing, short or non-string password with 400', async () => {
    for (const password of [undefined, 'ab', 12345]) {
      const res = await register({ password })
      assert.equal(res.status, 400, String(password))
    }
  })

  test('rejects a short username with 400', async () => {
    const res = await register({ username: 'ab' })
    assert.equal(res.status, 400)
  })

  test('rejects a duplicated username with 409', async () => {
    await register()
    const res = await register({ email: 'other@test.com' })

    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'That username already exists.')
  })

  test('rejects a duplicated email (case-insensitive) with 409', async () => {
    await register({ username: 'alice', email: 'same@test.com' })
    const res = await register({ username: 'bob', email: 'SAME@test.com' })

    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'That email is already registered.')
  })
})

describe('POST /api/users/verify-email', () => {
  test('verifies the email with the token from the mail', async () => {
    await register()
    const res = await verifyEmail(verifyTokenFor())

    assert.equal(res.status, 200)
    const user = await findUser()
    assert.equal(user.emailVerified, true)
    assert.equal(user.verifyTokenHash, undefined)
  })

  test('rejects an unknown, missing or non-string token with 400', async () => {
    await register()

    for (const token of ['deadbeef', undefined, '', { $ne: null }, 123]) {
      const res = await verifyEmail(token)
      assert.equal(res.status, 400, JSON.stringify(token))
      assert.equal(res.body.error, 'invalid or expired token')
    }
    assert.equal((await findUser()).emailVerified, false)
  })

  test('rejects an expired token with 400', async () => {
    await register()
    await expireToken('verify')

    const res = await verifyEmail(verifyTokenFor())
    assert.equal(res.status, 400)
  })

  test('a token works only once', async () => {
    await register()
    const token = verifyTokenFor()

    assert.equal((await verifyEmail(token)).status, 200)
    assert.equal((await verifyEmail(token)).status, 400)
  })
})

describe('POST /api/users/resend-verification', () => {
  test('sends a new token that replaces the previous one', async () => {
    await register()
    const first = verifyTokenFor()

    const res = await resendVerification('TESTER@test.com')
    assert.equal(res.status, 200)
    assert.equal(sentMails.length, 2)

    const second = verifyTokenFor()
    assert.notEqual(first, second)
    assert.equal((await verifyEmail(first)).status, 400)
    assert.equal((await verifyEmail(second)).status, 200)
  })

  test('answers the same for unknown or already verified emails, without sending', async () => {
    await registerVerified()
    clearSentMails()

    const verified = await resendVerification('tester@test.com')
    const unknown = await resendVerification('ghost@test.com')
    const invalid = await resendVerification({ $ne: null })

    assert.equal(verified.status, 200)
    assert.equal(unknown.status, 200)
    assert.equal(invalid.status, 200)
    assert.deepEqual(unknown.body, verified.body)
    assert.equal(sentMails.length, 0)
  })
})

describe('PUT /api/users/me/email', () => {
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

    assert.equal((await verifyEmail(verifyTokenFor('legacy'))).status, 200)
    assert.equal((await findUser('legacy')).emailVerified, true)
  })

  test('rejects an invalid email with 400 and a taken one with 409', async () => {
    await register({ username: 'alice', email: 'taken@test.com' })
    const token = await loginAsLegacy()

    const invalid = await setEmail(token, 'nope')
    const taken = await setEmail(token, 'taken@test.com')

    assert.equal(invalid.status, 400)
    assert.equal(taken.status, 409)
    assert.equal(taken.body.error, 'That email is already registered.')
  })
})

// ---------------------------------------------------------------------------
// Login and password reset
// ---------------------------------------------------------------------------

describe('POST /api/login', () => {
  test('once the email is verified, returns a token, the username and the email state', async () => {
    await registerVerified()
    const res = await login()

    assert.equal(res.status, 200)
    assert.ok(res.body.token)
    assert.equal(res.body.username, 'tester')
    assert.equal(res.body.emailVerified, true)
    assert.equal(res.body.hasEmail, true)
  })

  test('answers 403 with the right password while the email is unverified', async () => {
    await register()
    const res = await login()

    assert.equal(res.status, 403)
    assert.equal(res.body.error, 'email not verified')
    assert.equal(res.body.token, undefined)
  })

  test('answers 401 to a wrong password even if unverified (the state is not revealed)', async () => {
    await register()
    const res = await login('tester', 'nope')
    assert.equal(res.status, 401)
  })

  test('lets a legacy user without email log in', async () => {
    await createLegacyUser()
    const res = await login('legacy')

    assert.equal(res.status, 200)
    assert.equal(res.body.hasEmail, false)
    assert.equal(res.body.emailVerified, false)
  })

  test('answers 401 to an unknown user', async () => {
    const res = await login('ghost')
    assert.equal(res.status, 401)
  })

  test('answers 401 (not 500) to missing or non-string credentials', async () => {
    const empty = await api.post('/api/login').send({})
    const numeric = await login('tester', 123)

    assert.equal(empty.status, 401)
    assert.equal(numeric.status, 401)
  })
})

describe('POST /api/users/forgot-password', () => {
  test('sends a reset link to a verified email', async () => {
    await registerVerified()
    clearSentMails()

    const res = await forgotPassword('tester@test.com')
    assert.equal(res.status, 200)
    assert.equal(sentMails.length, 1)
    assert.ok(resetTokenFor())
  })

  test('answers the same for unknown or unverified emails, without sending', async () => {
    await register()
    clearSentMails()

    const unverified = await forgotPassword('tester@test.com')
    const unknown = await forgotPassword('ghost@test.com')

    assert.equal(unverified.status, 200)
    assert.equal(unknown.status, 200)
    assert.deepEqual(unknown.body, unverified.body)
    assert.equal(sentMails.length, 0)
  })
})

describe('POST /api/users/reset-password', () => {
  test('changes the password: the new one logs in, the old one no longer does', async () => {
    const token = await requestReset()

    assert.equal((await resetPassword(token, 'newpass')).status, 200)
    assert.equal((await login('tester', 'newpass')).status, 200)
    assert.equal((await login('tester', PASSWORD)).status, 401)
  })

  test('a token works only once', async () => {
    const token = await requestReset()

    assert.equal((await resetPassword(token, 'newpass')).status, 200)
    assert.equal((await resetPassword(token, 'other')).status, 400)
  })

  test('rejects an expired token with 400', async () => {
    const token = await requestReset()
    await expireToken('reset')

    const res = await resetPassword(token, 'newpass')
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid or expired token')
  })

  test('rejects an invalid password with 400 and keeps the token usable', async () => {
    const token = await requestReset()

    for (const password of [undefined, 'ab', 12345]) {
      assert.equal((await resetPassword(token, password)).status, 400, String(password))
    }
    assert.equal((await resetPassword(token, 'newpass')).status, 200)
  })
})

// ---------------------------------------------------------------------------
// Sightings
// ---------------------------------------------------------------------------

describe('POST /api/sightings', () => {
  describe('access', () => {
    test('requires a valid token', async () => {
      const noToken = await postSighting(null, 'AB123CD')
      const badToken = await postSighting('not-a-token', 'AB123CD')

      assert.equal(noToken.status, 401)
      assert.equal(badToken.status, 401)
    })

    test('rejects users without a verified email with 403 and deletes the photo', async () => {
      const token = await loginAsLegacy()

      const res = await postSighting(token, 'AB123CD')
      assert.equal(res.status, 403)
      assert.equal(res.body.error, 'email verification required')

      await waitForUnlink()
      assert.deepEqual(listUploads(), uploadsBefore)
      assert.equal(await Sighting.countDocuments(), 0)
    })
  })

  describe('validation', () => {
    test('rejects a missing plate or photo with 400', async () => {
      const token = await loginAsVerified()

      const noPlate = await postSighting(token, undefined)
      const noPhoto = await postSighting(token, 'AB123CD', { buffer: null })

      assert.equal(noPlate.status, 400)
      assert.equal(noPhoto.status, 400)
    })

    test('rejects an invalid plate format with 400', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'ABC123')
      assert.equal(res.status, 400)
    })

    test('rejects a non-image file with 400', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'AB123CD', {
        buffer: Buffer.from('<h1>hi</h1>'),
        filename: 'page.html',
        contentType: 'text/html'
      })
      assert.equal(res.status, 400)
    })

    test('rejects a disallowed original extension even with an image mimetype', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'AB123CD', {
        buffer: Buffer.from('<script>alert(1)</script>'),
        filename: 'evil.html',
        contentType: 'image/png'
      })
      assert.equal(res.status, 400)
    })
  })

  describe('game rules', () => {
    test('accepts a valid sighting, normalizing the plate', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'ab 123-cd')

      assert.equal(res.status, 201)
      assert.equal(res.body.plate, 'AB123CD')
      assert.equal(res.body.user, 'tester')
      assert.match(res.body.photoUrl, /^\/uploads\/.+\.png$/)
    })

    test('rejects a duplicated plate with 409', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const res = await postSighting(token, 'AB123CD')
      assert.equal(res.status, 409)
    })

    test('rejects a plate that is not newer than the top with 422', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const res = await postSighting(token, 'AA123CD')
      assert.equal(res.status, 422)
      assert.equal(res.body.currentTop, 'AB123CD')
    })

    test('accepts a newer plate', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const res = await postSighting(token, 'AC123CD')
      assert.equal(res.status, 201)
    })

    test('advances the last letters first, then the digits', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AA000AB')

      const older = await postSighting(token, 'AA000AA')
      const newer = await postSighting(token, 'AA001AA')
      assert.equal(older.status, 422)
      assert.equal(newer.status, 201)
    })
  })

  describe('uploaded photos', () => {
    test('are deleted when the sighting is rejected', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      const afterFirst = listUploads()

      await postSighting(token, 'AA123CD') // 422
      await postSighting(token, 'AB123CD') // 409
      await postSighting(token, 'ABC123') // 400

      await waitForUnlink()
      assert.deepEqual(listUploads(), afterFirst)
    })

    test('are stored under a server-generated name and served with nosniff', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'AB123CD', { filename: '../../evil name.PNG' })

      assert.equal(res.status, 201)
      assert.doesNotMatch(res.body.photoUrl, /evil/)
      assert.match(res.body.photoUrl, /\.png$/)

      const file = await api.get(res.body.photoUrl)
      assert.equal(file.status, 200)
      assert.match(file.headers['content-type'], /image\/png/)
      assert.equal(file.headers['x-content-type-options'], 'nosniff')
    })
  })
})

// ---------------------------------------------------------------------------
// Public game endpoints
// ---------------------------------------------------------------------------

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
    const token = await loginAsVerified()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')

    const res = await api.get('/api/top')
    assert.equal(res.body.plate, 'AC123CD')
    assert.equal(res.body.user, 'tester')
  })

  test('/history lists newest first', async () => {
    const token = await loginAsVerified()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')

    const res = await api.get('/api/history')
    assert.deepEqual(res.body.map((s) => s.plate), ['AC123CD', 'AB123CD'])
  })

  test('/ranking counts sightings per user, highest first', async () => {
    const alice = await loginAsVerified('alice')
    const bob = await loginAsVerified('bob')
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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('malformed requests', () => {
  test('malformed JSON answers 400, not 500', async () => {
    const res = await api.post('/api/login').set('Content-Type', 'application/json').send('{bad')
    assert.equal(res.status, 400)
  })
})
