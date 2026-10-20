const normalizePlate = (plate) => {
  if (typeof plate !== 'string') {
    // named ValidationError so the errorHandler answers 400 instead of 500
    const error = new Error('license plate must be a text string')
    error.name = 'ValidationError'
    throw error
  }

  const plateUpperCase = plate.toUpperCase()
  const plateNormalized = plateUpperCase.replace(/[\s-]/g, '')

  return plateNormalized
}

const sortKey = (plate) => {
  const firstCharts = plate.slice(0, 2)
  const numbers = plate.slice(2, 5)
  const lastCharts = plate.slice(5, 7)

  return `${firstCharts}-${numbers}-${lastCharts}`
}

const isNewerThan = (a, b) => {
  return sortKey(a) > sortKey(b)
}

// Mercosur format: 2 letters + 3 digits + 2 letters (e.g. AB123CD)
const isValidPlate = (plate) => {
  return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(plate)
}

// time as top per user, derived from createdAt alone: every accepted sighting becomes
// the top the moment it is created and stays so until the next one is created.
// sightings: [{ user, createdAt }] sorted by createdAt ascending
const computeTimeRanking = (sightings, now = new Date()) => {
  const totals = new Map() // user id -> ms as top (Map keeps first-appearance order for ties)

  sightings.forEach((sighting, i) => {
    const next = sightings[i + 1]
    const end = next ? next.createdAt : now
    const userId = String(sighting.user)
    totals.set(userId, (totals.get(userId) ?? 0) + (end - sighting.createdAt))
  })

  const currentTop = sightings.length > 0 ? String(sightings[sightings.length - 1].user) : null

  return [...totals.entries()]
    .map(([userId, totalMs]) => ({ userId, totalMs, isCurrentTop: userId === currentTop }))
    .sort((a, b) => b.totalMs - a.totalMs)
}

export default {
  normalizePlate,
  sortKey,
  isNewerThan,
  isValidPlate,
  computeTimeRanking
}
