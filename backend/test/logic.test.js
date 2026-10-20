import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import logic from '../src/utils/logic.js'

describe('normalizePlate', () => {
  test('uppercases and strips spaces and hyphens', () => {
    assert.equal(logic.normalizePlate('ab 123-cd'), 'AB123CD')
  })

  test('leaves an already normalized plate untouched', () => {
    assert.equal(logic.normalizePlate('AB123CD'), 'AB123CD')
  })

  test('throws a ValidationError for non-string input', () => {
    assert.throws(() => logic.normalizePlate(123), { name: 'ValidationError' })
    assert.throws(() => logic.normalizePlate(undefined), { name: 'ValidationError' })
  })
})

describe('isValidPlate', () => {
  test('accepts the Mercosur format', () => {
    assert.equal(logic.isValidPlate('AB123CD'), true)
  })

  test('rejects malformed plates', () => {
    for (const plate of ['', 'AB12CD', 'ABC123', 'ab123cd', 'AB1234CD', 'AB123C', '1B123CD']) {
      assert.equal(logic.isValidPlate(plate), false, plate)
    }
  })
})

describe('sortKey', () => {
  test('is firstLetters-digits-lastLetters', () => {
    assert.equal(logic.sortKey('AB123CD'), 'AB-123-CD')
  })
})

describe('isNewerThan', () => {
  test('first letters weigh the most', () => {
    assert.equal(logic.isNewerThan('AB000AA', 'AA999ZZ'), true)
  })

  test('then the digits', () => {
    assert.equal(logic.isNewerThan('AA001AA', 'AA000ZZ'), true)
  })

  test('then the last letters', () => {
    assert.equal(logic.isNewerThan('AA000AB', 'AA000AA'), true)
  })

  test('the last letters roll over before the digits advance', () => {
    assert.equal(logic.isNewerThan('AA001AA', 'AA000AB'), true)
  })

  test('an older plate is not newer', () => {
    assert.equal(logic.isNewerThan('AA000AB', 'AA001AA'), false)
  })

  test('the same plate is not newer than itself', () => {
    assert.equal(logic.isNewerThan('AB123CD', 'AB123CD'), false)
  })
})

describe('computeTimeRanking', () => {
  const t = (seconds) => new Date(2026, 0, 1, 0, 0, seconds)
  const now = t(100)

  test('is empty when there are no sightings', () => {
    assert.deepEqual(logic.computeTimeRanking([], now), [])
  })

  test('a single sighting reigns until now', () => {
    const result = logic.computeTimeRanking([{ user: 'a', createdAt: t(40) }], now)
    assert.deepEqual(result, [{ userId: 'a', totalMs: 60000, isCurrentTop: true }])
  })

  test('each sighting reigns until the next one is created', () => {
    const result = logic.computeTimeRanking([
      { user: 'a', createdAt: t(0) },
      { user: 'b', createdAt: t(30) }
    ], now)
    assert.deepEqual(result, [
      { userId: 'b', totalMs: 70000, isCurrentTop: true },
      { userId: 'a', totalMs: 30000, isCurrentTop: false }
    ])
  })

  test('adds up several reigns of the same user', () => {
    const result = logic.computeTimeRanking([
      { user: 'a', createdAt: t(0) },
      { user: 'b', createdAt: t(10) },
      { user: 'a', createdAt: t(20) },
      { user: 'b', createdAt: t(50) }
    ], now)
    const a = result.find((r) => r.userId === 'a')
    const b = result.find((r) => r.userId === 'b')
    assert.equal(a.totalMs, 40000) // 10s + 30s
    assert.equal(b.totalMs, 60000) // 10s + 50s
    assert.equal(result[0].userId, 'b')
  })

  test('compares ObjectId-like users by their string value', () => {
    const id = () => ({ toString: () => 'same-id' })
    const result = logic.computeTimeRanking([
      { user: id(), createdAt: t(0) },
      { user: id(), createdAt: t(10) }
    ], now)
    assert.equal(result.length, 1)
    assert.equal(result[0].totalMs, 100000)
  })
})
