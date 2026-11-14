import { test, describe, before, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import supertest from 'supertest'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

import app from '../src/app.js'
import config from '../src/utils/config.js'
import User from '../src/models/user.model.js'
import Sighting from '../src/models/sighting.model.js'
import plateLogic from '../src/utils/logic.js'
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

const mySightings = (token) => withAuth(api.get('/api/sightings/mine'), token)

const pendingQueue = (token) => withAuth(api.get('/api/moderation/pending'), token)
const approveById = (token, id) => withAuth(api.post(`/api/moderation/${id}/approve`), token)
const rejectById = (token, id, reason) => withAuth(api.post(`/api/moderation/${id}/reject`), token).send({ reason })

// moderators come from config.MODERATORS (read from the env at import): tests add them by hand
let moderatorTokens = {}

// registers the moderator the first time it is asked for in a test and returns its JWT
const loginAsModerator = async (username = 'mod1') => {
  config.MODERATORS.add(username)
  moderatorTokens[username] ??= await loginAsVerified(username)
  return moderatorTokens[username]
}

const findSighting = (plate, status = 'pending') => Sighting.findOne({ licensePlate: plate, status })
const idOf = async (plate) => (await findSighting(plate)).id

// mod1 decides on the pending sighting with that plate
const approve = async (plate) => {
  const res = await approveById(await loginAsModerator(), await idOf(plate))
  assert.equal(res.status, 200)
  return res
}

const reject = async (plate, reason = 'blurry') => {
  const res = await rejectById(await loginAsModerator(), await idOf(plate), reason)
  assert.equal(res.status, 200)
  return res
}

// a sighting stored straight in the database, skipping the API (no real photo behind it)
const storedSighting = (user, licensePlate, fields = {}) => ({
  user: user._id,
  licensePlate,
  sortKey: plateLogic.sortKey(licensePlate),
  photoPath: 'x.png',
  ...fields
})

// n different valid plates: AA000AA, AA001AA, ...
const manyPlates = (n) => Array.from({ length: n }, (_, i) => `AA${String(i).padStart(3, '0')}AA`)

const photoExists = (sighting) => fs.existsSync(path.join(uploadDir, path.basename(sighting.photoPath)))

// mails are sent after the response: wait until that many have shown up
const waitForMails = async (count) => {
  for (let i = 0; i < 50 && sentMails.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const mailsTo = (username) => sentMails.filter((m) => m.to === emailOf(username))

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
  moderatorTokens = {}
  uploadsBefore = listUploads()
})

// remove the photos created by the test
afterEach(() => {
  config.MODERATORS.clear()
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

  test('a verified user that changes it is unverified again and loses the pending reset link', async () => {
    const resetToken = await requestReset()
    const { body } = await login()

    const res = await setEmail(body.token, 'new@test.com')
    assert.equal(res.status, 200)
    assert.equal(res.body.emailVerified, false)

    // the reset link went to the previous address
    assert.equal((await resetPassword(resetToken, 'newpass')).status, 400)
    assert.equal((await login()).status, 403)

    assert.equal((await verifyEmail(tokenFromMail('new@test.com', 'verify'))).status, 200)
    assert.equal((await login()).status, 200)
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

    test('rejects a token that expired or was signed with another secret', async () => {
      await registerVerified()
      const payload = { username: 'tester', id: (await findUser()).id }

      const expired = jwt.sign(payload, config.SECRET, { expiresIn: -10 })
      const forged = jwt.sign(payload, `${config.SECRET}-other`, { expiresIn: '7d' })

      assert.equal((await mySightings(expired)).status, 401)
      assert.equal((await mySightings(forged)).status, 401)
    })

    test('rejects the token of a user that no longer exists', async () => {
      const token = await loginAsVerified()
      await User.deleteMany({})

      const res = await mySightings(token)
      assert.equal(res.status, 401)
      assert.equal(res.body.error, 'user not found')
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

    test('rejects a photo over MAX_UPLOAD_MB with 400 and keeps nothing on disk', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'AB123CD', {
        buffer: Buffer.alloc(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
      })

      assert.equal(res.status, 400)
      assert.equal(res.body.error, `The image exceeds the ${config.MAX_UPLOAD_MB} MB limit.`)

      await waitForUnlink()
      assert.deepEqual(listUploads(), uploadsBefore)
      assert.equal(await Sighting.countDocuments(), 0)
    })
  })

  describe('game rules', () => {
    test('accepts a valid sighting, normalizing the plate', async () => {
      const token = await loginAsVerified()
      const res = await postSighting(token, 'ab 123-cd')

      assert.equal(res.status, 202)
      assert.equal(res.body.plate, 'AB123CD')
      assert.equal(res.body.status, 'pending')
      assert.equal((await Sighting.findOne()).status, 'pending')
    })

    test('rejects a plate that is already pending or approved with 409', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const whilePending = await postSighting(token, 'AB123CD')
      assert.equal(whilePending.status, 409)

      await approve('AB123CD')
      const onceApproved = await postSighting(token, 'AB123CD')
      assert.equal(onceApproved.status, 409)
    })

    test('a rejected plate can be sent again, by anyone', async () => {
      const token = await loginAsVerified()
      const other = await loginAsVerified('other')
      await postSighting(token, 'AB123CD')
      await reject('AB123CD')

      const res = await postSighting(other, 'AB123CD')
      assert.equal(res.status, 202)
    })

    test('rejects the 4th pending sighting of a user with 429 and deletes the photo', async () => {
      const token = await loginAsVerified()
      for (const plate of ['AB123CD', 'AC123CD', 'AD123CD']) {
        assert.equal((await postSighting(token, plate)).status, 202)
      }
      const afterThree = listUploads()

      const res = await postSighting(token, 'AE123CD')
      assert.equal(res.status, 429)
      assert.equal(res.body.error, 'too many pending sightings')

      await waitForUnlink()
      assert.deepEqual(listUploads(), afterThree)

      // once one is decided there is room again
      await approve('AB123CD')
      assert.equal((await postSighting(token, 'AE123CD')).status, 202)
    })

    test('two simultaneous sightings of the same plate: only one is kept', async () => {
      const alice = await loginAsVerified('alice')
      const bob = await loginAsVerified('bob')

      const responses = await Promise.all([postSighting(alice, 'AB123CD'), postSighting(bob, 'AB123CD')])
      assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409])
      assert.equal(await Sighting.countDocuments({ licensePlate: 'AB123CD' }), 1)

      await waitForUnlink()
      assert.equal(listUploads().size, uploadsBefore.size + 1)
    })

    test('a pending sighting is not the top yet: an older plate is still accepted', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const res = await postSighting(token, 'AA123CD')
      assert.equal(res.status, 202)
    })

    test('rejects a plate that is not newer than the approved top with 422', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await approve('AB123CD')

      const res = await postSighting(token, 'AA123CD')
      assert.equal(res.status, 422)
      assert.equal(res.body.currentTop, 'AB123CD')
    })

    test('accepts a plate newer than the approved top', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await approve('AB123CD')

      const res = await postSighting(token, 'AC123CD')
      assert.equal(res.status, 202)
    })

    test('advances the last letters first, then the digits', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AA000AB')
      await approve('AA000AB')

      const older = await postSighting(token, 'AA000AA')
      const newer = await postSighting(token, 'AA001AA')
      assert.equal(older.status, 422)
      assert.equal(newer.status, 202)
    })
  })

  describe('uploaded photos', () => {
    test('are deleted when the sighting is rejected', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await approve('AB123CD')
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

      assert.equal(res.status, 202)

      const { photoUrl } = (await mySightings(token)).body[0]
      assert.doesNotMatch(photoUrl, /evil/)
      assert.match(photoUrl, /^\/uploads\/.+\.png$/)

      const file = await api.get(photoUrl)
      assert.equal(file.status, 200)
      assert.match(file.headers['content-type'], /image\/png/)
      assert.equal(file.headers['x-content-type-options'], 'nosniff')
      assert.match(file.headers['cache-control'], /immutable/)
    })

    test('get their extension from the mimetype, not from the original name', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD', { filename: 'photo.jpeg', contentType: 'image/jpeg' })
      await postSighting(token, 'AC123CD', { filename: 'photo.png', contentType: 'image/webp' })

      const photos = Object.fromEntries((await mySightings(token)).body.map((s) => [s.plate, s.photoUrl]))
      assert.match(photos.AB123CD, /\.jpg$/)
      assert.match(photos.AC123CD, /\.webp$/)
    })
  })
})

describe('mail to the moderators', () => {
  test('a new sighting is mailed to every verified moderator except its author', async () => {
    for (const name of ['mod1', 'mod2', 'mod3']) config.MODERATORS.add(name)
    await registerVerified('mod1')
    const mod2 = await loginAsVerified('mod2')
    await register({ username: 'mod3' }) // never verifies the email
    clearSentMails()

    assert.equal((await postSighting(mod2, 'AB123CD')).status, 202)
    await waitForMails(1)
    await waitForUnlink() // room for a wrong extra mail to show up

    assert.deepEqual(sentMails.map((m) => m.to), [emailOf('mod1')])
    assert.match(sentMails[0].subject, /AB 123 CD/)
    assert.match(sentMails[0].text, /mod2/)
    assert.match(sentMails[0].text, /\/moderacion/)
  })

  test('nothing is sent when the sighting is rejected', async () => {
    config.MODERATORS.add('mod1')
    await registerVerified('mod1')
    const token = await loginAsVerified()
    clearSentMails()

    assert.equal((await postSighting(token, 'ABC123')).status, 400)
    await waitForUnlink()
    assert.equal(sentMails.length, 0)
  })
})

describe('GET /api/sightings/mine', () => {
  test('requires a valid token', async () => {
    assert.equal((await mySightings(null)).status, 401)
  })

  test('lists only the sightings of the user, newest first, with their status', async () => {
    const token = await loginAsVerified()
    const other = await loginAsVerified('other')
    await postSighting(token, 'AB123CD')
    await postSighting(other, 'AC123CD')
    await postSighting(token, 'AD123CD')
    await reject('AB123CD', 'blurry')

    const res = await mySightings(token)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.map((s) => [s.plate, s.status]), [
      ['AD123CD', 'pending'],
      ['AB123CD', 'rejected']
    ])
    assert.deepEqual(Object.keys(res.body[0]).sort(), [
      'createdAt', 'decidedAt', 'id', 'photoUrl', 'plate', 'rejectReason', 'status'
    ])
    assert.equal(res.body[0].rejectReason, null)
    assert.equal(res.body[0].decidedAt, null)
    assert.equal(res.body[1].rejectReason, 'blurry')
    assert.ok(res.body[1].decidedAt)
  })

  test('photoUrl comes only while the photo exists: pending ones and the current top', async () => {
    const token = await loginAsVerified()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')
    await postSighting(token, 'AD123CD')
    await approve('AB123CD')
    await approve('AC123CD') // AB123CD is no longer the top
    await reject('AD123CD')
    await postSighting(token, 'AE123CD')

    const res = await mySightings(token)
    const photos = Object.fromEntries(res.body.map((s) => [s.plate, s.photoUrl]))
    assert.equal(photos.AB123CD, null)
    assert.match(photos.AC123CD, /^\/uploads\//)
    assert.equal(photos.AD123CD, null)
    assert.match(photos.AE123CD, /^\/uploads\//)
  })

  test('lists at most the latest 20', async () => {
    const token = await loginAsVerified()
    const user = await findUser()
    await Sighting.insertMany(manyPlates(21).map((plate, i) =>
      storedSighting(user, plate, { status: 'rejected', createdAt: new Date(Date.now() - i * 1000) })))

    const res = await mySightings(token)
    assert.equal(res.body.length, 20)
    assert.equal(res.body[0].plate, 'AA000AA') // the newest
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

  test('/top returns the newest approved plate, with since', async () => {
    const token = await loginAsVerified()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')
    await approve('AB123CD')
    await approve('AC123CD')

    const res = await api.get('/api/top')
    assert.equal(res.body.plate, 'AC123CD')
    assert.equal(res.body.user, 'tester')
    assert.equal(res.body.since, res.body.createdAt)
  })

  test('/history lists newest first', async () => {
    const token = await loginAsVerified()
    await postSighting(token, 'AB123CD')
    await postSighting(token, 'AC123CD')
    await approve('AB123CD')
    await approve('AC123CD')

    const res = await api.get('/api/history')
    assert.deepEqual(res.body.map((s) => s.plate), ['AC123CD', 'AB123CD'])
  })

  test('/history lists at most the latest 50', async () => {
    const user = await User.create({ username: 'alice', passwordHash: 'x' })
    await Sighting.insertMany(manyPlates(51).map((plate, i) =>
      storedSighting(user, plate, { status: 'approved', createdAt: new Date(Date.now() - i * 1000) })))

    const res = await api.get('/api/history')
    assert.equal(res.body.length, 50)
    assert.equal(res.body[0].plate, 'AA000AA') // the newest
    assert.equal(res.body[0].photoUrl, '/uploads/x.png')
  })

  test('ignore pending, rejected and superseded sightings', async () => {
    const alice = await loginAsVerified('alice')
    const bob = await loginAsVerified('bob')
    await postSighting(alice, 'AC123CD')
    await postSighting(bob, 'AB123CD') // superseded once AC123CD is approved
    await postSighting(bob, 'AD123CD') // rejected
    await postSighting(bob, 'AE123CD') // stays pending
    await approve('AC123CD')
    await reject('AD123CD')

    const top = await api.get('/api/top')
    const history = await api.get('/api/history')
    const ranking = await api.get('/api/ranking')
    const time = await api.get('/api/ranking/time')

    assert.equal(top.body.plate, 'AC123CD')
    assert.deepEqual(history.body.map((s) => s.plate), ['AC123CD'])
    assert.deepEqual(ranking.body, [{ username: 'alice', tops: 1 }])
    assert.deepEqual(time.body.map((r) => r.username), ['alice'])
  })

  test('/ranking counts sightings per user, highest first', async () => {
    const alice = await loginAsVerified('alice')
    const bob = await loginAsVerified('bob')
    await postSighting(alice, 'AB123CD')
    await postSighting(bob, 'AC123CD')
    await postSighting(bob, 'AD123CD')
    for (const plate of ['AB123CD', 'AC123CD', 'AD123CD']) await approve(plate)

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
      storedSighting(user, licensePlate, { createdAt, status: 'approved' })

    // alice: 10h -> 7h ago (3h); bob: 7h -> 2h ago (5h); alice again: 2h ago -> now (2h)
    await Sighting.create([
      sighting(alice, 'AA111AA', hoursAgo(10)),
      sighting(bob, 'AB111AA', hoursAgo(7)),
      sighting(alice, 'AC111AA', hoursAgo(2)),
      { ...sighting(bob, 'AD111AA', hoursAgo(1)), status: 'pending' } // doesn't count
    ])

    const res = await api.get('/api/ranking/time')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.map((r) => r.username), ['alice', 'bob'])
    assert.deepEqual(res.body.map((r) => r.isCurrentTop), [true, false])

    const hours = (ms) => Math.round(ms / 3600000)
    assert.equal(hours(res.body[0].totalMs), 5) // alice: 3h + 2h
    assert.equal(hours(res.body[1].totalMs), 5) // bob: 5h
  })

  test('a plate approved after a later, older one starts when that one did', async () => {
    const alice = await User.create({ username: 'alice', passwordHash: 'x' })
    const bob = await User.create({ username: 'bob', passwordHash: 'x' })
    const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000)

    // alice sent the newer plate first (6h ago), but bob's older one (2h ago) was the top before it
    await Sighting.create([
      storedSighting(alice, 'AC111AA', { createdAt: hoursAgo(6), status: 'approved' }),
      storedSighting(bob, 'AB111AA', { createdAt: hoursAgo(2), status: 'approved' })
    ])

    const time = await api.get('/api/ranking/time')
    const hours = (ms) => Math.round(ms / 3600000)
    assert.deepEqual(time.body.map((r) => [r.username, hours(r.totalMs)]), [['alice', 2], ['bob', 0]])

    const top = await api.get('/api/top')
    assert.equal(top.body.plate, 'AC111AA')
    assert.equal(hours(Date.now() - new Date(top.body.since)), 2)
  })
})

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

describe('/api/moderation', () => {
  describe('access', () => {
    test('requires a token (401) and a moderator (403)', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      const id = await idOf('AB123CD')

      for (const request of [pendingQueue, (t) => approveById(t, id), (t) => rejectById(t, id, 'no')]) {
        assert.equal((await request(null)).status, 401)
        const res = await request(token)
        assert.equal(res.status, 403)
        assert.equal(res.body.error, 'moderator only')
      }
      assert.ok(await findSighting('AB123CD'))
    })

    test('the login tells whether the user is a moderator', async () => {
      await loginAsModerator('mod1')
      await registerVerified()

      assert.equal((await login('mod1')).body.isModerator, true)
      assert.equal((await login()).body.isModerator, false)
    })
  })

  describe('GET /pending', () => {
    test('lists the queue oldest first, with isOwn and newerThanTop', async () => {
      const mod = await loginAsModerator()
      const token = await loginAsVerified()
      await postSighting(token, 'AC123CD')
      await approve('AC123CD')
      await postSighting(token, 'AE123CD')
      await postSighting(mod, 'AD123CD')
      // older than the top: can't be sent anymore, but it can be left behind by a later approval
      await Sighting.create(storedSighting(await findUser(), 'AB123CD'))

      const res = await pendingQueue(mod)
      assert.equal(res.status, 200)
      assert.equal(res.body.currentTop, 'AC123CD')
      assert.deepEqual(
        res.body.items.map((s) => [s.plate, s.user, s.isOwn, s.newerThanTop]),
        [
          ['AE123CD', 'tester', false, true],
          ['AD123CD', 'mod1', true, true],
          ['AB123CD', 'tester', false, false]
        ]
      )
      assert.equal(res.body.items[0].id, await idOf('AE123CD'))
      assert.match(res.body.items[0].photoUrl, /^\/uploads\/.+\.png$/)
      assert.ok(res.body.items[0].createdAt)
    })

    test('is empty, with a null top, when there is nothing', async () => {
      const res = await pendingQueue(await loginAsModerator())
      assert.deepEqual(res.body, { currentTop: null, items: [] })
    })
  })

  describe('POST /:id/approve', () => {
    test('makes it the top, deletes the photo of the previous one and records who decided', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await approve('AB123CD')
      await postSighting(token, 'AC123CD')

      const res = await approve('AC123CD')
      assert.equal(res.body.plate, 'AC123CD')
      assert.equal(res.body.user, 'tester')
      assert.equal((await api.get('/api/top')).body.plate, 'AC123CD')

      const approved = await findSighting('AC123CD', 'approved')
      assert.ok(approved.decidedAt)
      assert.ok(approved.decidedBy.equals((await findUser('mod1'))._id))

      await waitForUnlink()
      assert.equal(photoExists(approved), true)
      assert.equal(photoExists(await findSighting('AB123CD', 'approved')), false)
    })

    test('supersedes the pending plates that are no longer newer, deleting their photos', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await postSighting(token, 'AD123CD')
      await postSighting(token, 'AE123CD')

      await approve('AD123CD')

      const older = await findSighting('AB123CD', 'superseded')
      assert.ok(older)
      assert.ok(older.decidedAt)
      assert.ok(await findSighting('AE123CD')) // newer: still pending

      await waitForUnlink()
      assert.equal(photoExists(older), false)
      assert.equal(photoExists(await findSighting('AE123CD')), true)
    })

    test('answers 404 to an unknown or malformed id', async () => {
      const mod = await loginAsModerator()
      assert.equal((await approveById(mod, new mongoose.Types.ObjectId())).status, 404)
      assert.equal((await approveById(mod, 'not-an-id')).status, 404)
    })

    test('answers 403 to a moderator approving their own sighting, which stays pending', async () => {
      const mod = await loginAsModerator()
      await postSighting(mod, 'AB123CD')

      const res = await approveById(mod, await idOf('AB123CD'))
      assert.equal(res.status, 403)
      assert.equal(res.body.error, 'cannot moderate own sighting')
      assert.ok(await findSighting('AB123CD'))
    })

    test('answers 409 to a sighting that was already decided', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      const id = await idOf('AB123CD')
      await approve('AB123CD')

      const again = await approveById(await loginAsModerator(), id)
      assert.equal(again.status, 409)
      assert.equal(again.body.error, 'already decided')

      const rejectIt = await rejectById(await loginAsModerator(), id, 'too late')
      assert.equal(rejectIt.status, 409)
      assert.equal((await findSighting('AB123CD', 'approved')).rejectReason, undefined)
    })

    test('answers 409 superseded when it is no longer newer than the top', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AC123CD')
      await approve('AC123CD')
      // can only happen when two approvals race: a pending plate older than the top
      const stale = await Sighting.create(storedSighting(await findUser(), 'AB123CD'))

      const res = await approveById(await loginAsModerator(), stale.id)
      assert.equal(res.status, 409)
      assert.equal(res.body.error, 'superseded')
      assert.equal(res.body.currentTop, 'AC123CD')
      assert.ok(await findSighting('AB123CD', 'superseded'))
      assert.equal((await api.get('/api/top')).body.plate, 'AC123CD')
    })
  })

  describe('POST /:id/reject', () => {
    test('requires a reason of 1 to 300 characters', async () => {
      const mod = await loginAsModerator()
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      const id = await idOf('AB123CD')

      for (const reason of [undefined, '', '   ', 42, 'x'.repeat(301)]) {
        assert.equal((await rejectById(mod, id, reason)).status, 400)
      }
      assert.ok(await findSighting('AB123CD'))
    })

    test('rejects it with the trimmed reason and deletes the photo', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')

      const res = await reject('AB123CD', '  the plate is not readable  ')
      assert.equal(res.body.status, 'rejected')

      const rejected = await findSighting('AB123CD', 'rejected')
      assert.equal(rejected.rejectReason, 'the plate is not readable')
      assert.ok(rejected.decidedAt)
      assert.ok(rejected.decidedBy.equals((await findUser('mod1'))._id))
      assert.equal((await api.get('/api/top')).body, null)

      await waitForUnlink()
      assert.equal(photoExists(rejected), false)
    })

    test('answers 404 to an unknown id and 403 to a moderator rejecting their own', async () => {
      const mod = await loginAsModerator()
      await postSighting(mod, 'AB123CD')

      assert.equal((await rejectById(mod, new mongoose.Types.ObjectId(), 'no')).status, 404)
      assert.equal((await rejectById(mod, await idOf('AB123CD'), 'no')).status, 403)
      assert.ok(await findSighting('AB123CD'))
    })
  })

  describe('two moderators at once', () => {
    test('only one decision on the same sighting wins, and the author gets one mail', async () => {
      const mod1 = await loginAsModerator('mod1')
      const mod2 = await loginAsModerator('mod2')
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      const id = await idOf('AB123CD')
      await waitForMails(sentMails.length + 2) // the ones to the moderators
      clearSentMails()

      const responses = await Promise.all([approveById(mod1, id), rejectById(mod2, id, 'blurry')])
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])

      const [approved, rejected] = responses
      const decided = await Sighting.findById(id)
      assert.equal(decided.status, approved.status === 200 ? 'approved' : 'rejected')
      assert.equal(decided.rejectReason, rejected.status === 200 ? 'blurry' : undefined)

      await waitForMails(1)
      await waitForUnlink() // room for a wrong extra mail to show up
      assert.equal(mailsTo('tester').length, 1)
    })
  })

  describe('mail to the author', () => {
    test('one per decision: approved, rejected (with the reason) and superseded', async () => {
      const alice = await loginAsVerified('alice')
      const bob = await loginAsVerified('bob')
      const carol = await loginAsVerified('carol')
      await loginAsModerator()
      await postSighting(alice, 'AB123CD')
      await postSighting(bob, 'AD123CD')
      await postSighting(carol, 'AE123CD')
      await waitForMails(sentMails.length + 3) // the ones to the moderator
      clearSentMails()

      await approve('AD123CD') // supersedes alice's
      await reject('AE123CD', 'not <readable>')
      await waitForMails(3)
      await waitForUnlink() // room for a wrong extra mail to show up

      assert.equal(sentMails.length, 3)
      assert.match(mailsTo('bob')[0].text, /AD 123 CD fue aprobado/)
      assert.match(mailsTo('alice')[0].text, /AB 123 CD ya no puede ser punta/)
      assert.match(mailsTo('carol')[0].text, /AE 123 CD fue rechazado\. Motivo: not <readable>/)
      assert.match(mailsTo('carol')[0].html, /not &lt;readable&gt;/)
    })

    test('none when the email of the author is no longer verified', async () => {
      const token = await loginAsVerified()
      await postSighting(token, 'AB123CD')
      await setEmail(token, 'new@test.com') // unverified from now on
      await loginAsModerator()
      await waitForMails(sentMails.length + 1) // the one to the moderator
      clearSentMails()

      await approve('AB123CD')
      await waitForUnlink() // room for a wrong mail to show up
      assert.equal(sentMails.length, 0)
    })
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

  test('an unexpected error answers a generic 500, without leaking its message', async (t) => {
    t.mock.method(Sighting, 'findOne', () => { throw new Error('boom: internal detail') })

    const res = await api.get('/api/top')
    assert.equal(res.status, 500)
    assert.deepEqual(res.body, { error: 'Internal server error.' })
  })
})

// ---------------------------------------------------------------------------
// App wiring: health check, headers, unknown routes and rate limit
// ---------------------------------------------------------------------------

describe('app', () => {
  test('GET /health answers ok', async () => {
    const res = await api.get('/health')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { status: 'ok' })
  })

  test('the API is never cached and carries the security headers', async () => {
    const res = await api.get('/api/top')
    assert.equal(res.headers['cache-control'], 'no-cache')
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.match(res.headers['content-security-policy'], /fonts\.googleapis\.com/)
    assert.equal(res.headers['x-powered-by'], undefined)
  })

  test('unknown /api and /uploads paths answer 404, never the SPA or a listing', async () => {
    for (const url of ['/api/nothing', '/api', '/uploads/nothing.png', '/uploads/', '/uploads/.gitkeep']) {
      const res = await api.get(url)
      assert.equal(res.status, 404, url)
    }
  })

  // the limits are skipped with NODE_ENV=test (read on every request): turn them on for this test.
  // Runs last: the counters are kept in memory for the whole process
  test('rate limit: 5 per window on the mail routes, 100 on everything else but /health', async (t) => {
    t.mock.method(console, 'log', () => {}) // the logger is not silent outside test
    t.mock.method(console, 'error', () => {})
    const previousEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await forgotPassword('ghost@test.com')).status, 200)
      }
      const sixth = await forgotPassword('ghost@test.com')
      assert.equal(sixth.status, 429)
      assert.deepEqual(sixth.body, { error: 'Too many requests, try again later.' })
      assert.ok(sixth.headers['retry-after'])

      // the three routes share the counter; the rest of the API doesn't use it
      assert.equal((await resendVerification('ghost@test.com')).status, 429)
      assert.equal((await resetPassword('deadbeef', 'newpass')).status, 429)
      assert.equal((await login('ghost')).status, 401)

      // global limit: use up whatever is left of the 100
      for (let batch = 0; batch < 5; batch++) {
        await Promise.all(Array.from({ length: 20 }, () => api.get('/api/nothing')))
      }
      const blocked = await api.get('/api/top')
      assert.equal(blocked.status, 429)
      assert.deepEqual(blocked.body, { error: 'Too many requests, try again later.' })
      assert.equal((await api.get('/health')).status, 200)
    } finally {
      process.env.NODE_ENV = previousEnv
    }

    // back in test mode nothing is limited
    assert.equal((await api.get('/api/top')).status, 200)
  })
})
