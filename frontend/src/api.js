// backend client: all calls go through here

const TOKEN_KEY = 'token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

// backend messages are in English; the UI shows these Spanish versions
const MESSAGES_ES = {
  'invalid username or password': 'Usuario o contraseña incorrectos.',
  'The license plate is required.': 'La patente es obligatoria.',
  'The photo is required.': 'La foto es obligatoria.',
  'Invalid license plate format. Use the Mercosur format (e.g. AB123CD).': 'Formato de patente inválido. Usá el formato Mercosur (ej. AB123CD).',
  'That license plate has already been registered.': 'Esa patente ya fue registrada.',
  'The license plate is not newer than the current top.': 'La patente no es más nueva que la punta actual.',
  'That username already exists.': 'Ese nombre de usuario ya existe.',
  'password is missing': 'Falta la contraseña.',
  'password must be a text string': 'La contraseña debe ser texto.',
  'password must be at least 3 characters long': 'La contraseña debe tener al menos 3 caracteres.',
  'token missing or invalid': 'Tu sesión venció. Volvé a iniciar sesión.',
  'user not found': 'Usuario no encontrado.',
  'Too many requests, try again later.': 'Demasiados intentos, probá de nuevo más tarde.',
  'The image exceeds the 5 MB limit.': 'La imagen supera el límite de 5 MB.',
  'Image format not allowed. Use JPEG, PNG or WebP.': 'Formato de imagen no permitido. Usá JPEG, PNG o WebP.',
  'Internal server error.': 'Error interno del servidor.'
}

// does the fetch and throws an Error with the backend message on failure
const request = async (url, options = {}) => {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(MESSAGES_ES[data?.error] ?? data?.error ?? 'Error inesperado.')
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

const authHeaders = () => {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const jsonRequest = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

export const getTop = () => request('/api/top')
export const getHistory = () => request('/api/history')
export const getRanking = () => request('/api/ranking')
export const getTimeRanking = () => request('/api/ranking/time')

export const register = (username, password) =>
  jsonRequest('/api/users', { username, password })

export const login = (username, password) =>
  jsonRequest('/api/login', { username, password })

// multipart: Content-Type is not set, the browser adds the boundary
export const postSighting = (plate, photo) => {
  const formData = new FormData()
  formData.append('plate', plate)
  formData.append('photo', photo)

  return request('/api/sightings', {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  })
}
