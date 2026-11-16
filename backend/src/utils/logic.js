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

// when each sighting became the top. The time counts from the submission (createdAt), but a
// sighting can be approved after a later one with an older plate: it can't start before the
// top it replaces did, so the start is clamped (no negative or overlapping reigns).
// sightings: approved ones, [{ createdAt }] sorted by sortKey ascending (the order they were top)
const reignStarts = (sightings) => {
  const starts = []
  sightings.forEach((sighting, i) => {
    starts.push(i > 0 && starts[i - 1] > sighting.createdAt ? starts[i - 1] : sighting.createdAt)
  })
  return starts
}

// since when the current top is the top (null when there are no sightings)
const topSince = (sightings) => reignStarts(sightings).at(-1) ?? null

// time as top per user: every approved sighting is the top from its start (see reignStarts)
// until the start of the next one; the last one, until now.
// sightings: approved ones, [{ user, createdAt }] sorted by sortKey ascending
const computeTimeRanking = (sightings, now = new Date()) => {
  const totals = new Map() // user id -> ms as top (Map keeps first-appearance order for ties)
  const starts = reignStarts(sightings)

  sightings.forEach((sighting, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : now
    const userId = String(sighting.user)
    totals.set(userId, (totals.get(userId) ?? 0) + (end - starts[i]))
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
  topSince,
  computeTimeRanking
}
