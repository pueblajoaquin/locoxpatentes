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
  'email is missing': 'Falta el correo.',
  'invalid email': 'El correo no es válido.',
  'That email is already registered.': 'Ese correo ya está registrado.',
  'email not verified': 'Todavía no verificaste tu correo.',
  'email verification required': 'Tenés que verificar tu correo para enviar avistamientos.',
  'invalid or expired token': 'El link es inválido o venció.',
  'Too many requests, try again later.': 'Demasiados intentos, probá de nuevo más tarde.',
  'The image exceeds the 5 MB limit.': 'La imagen supera el límite de 5 MB.',
  'Image format not allowed. Use JPEG, PNG or WebP.': 'Formato de imagen no permitido. Usá JPEG, PNG o WebP.',
  'too many pending sightings': 'Ya tenés 3 envíos pendientes. Esperá a que se moderen.',
  'already decided': 'Ese avistamiento ya fue moderado.',
  superseded: 'Ya se aprobó una patente más nueva; quedó superada.',
  'cannot moderate own sighting': 'No podés moderar tus propios envíos.',
  'moderator only': 'Solo para moderadores.',
  'sighting not found': 'Ese avistamiento no existe.',
  'A reject reason of 1 to 300 characters is required.': 'El motivo del rechazo es obligatorio (hasta 300 caracteres).',
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

const jsonRequest = (url, body, method = 'POST', headers = {}) => request(url, {
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
})

export const getTop = () => request('/api/top')
export const getHistory = () => request('/api/history')
export const getRanking = () => request('/api/ranking')
export const getTimeRanking = () => request('/api/ranking/time')

// registers without a session: the account stays pending until the email is verified
export const register = (username, email, password) =>
  jsonRequest('/api/users', { username, email, password })

export const login = (username, password) =>
  jsonRequest('/api/login', { username, password })

// tokens come from the links in the emails and travel in the body, never in the API URL
export const verifyEmail = (token) =>
  jsonRequest('/api/users/verify-email', { token })

export const resetPassword = (token, password) =>
  jsonRequest('/api/users/reset-password', { token, password })

// both answer the same whether or not the email exists
export const resendVerification = (email) =>
  jsonRequest('/api/users/resend-verification', { email })

export const forgotPassword = (email) =>
  jsonRequest('/api/users/forgot-password', { email })

// sets (or replaces) the email of the logged-in user and sends a verification link
export const setEmail = (email) =>
  jsonRequest('/api/users/me/email', { email }, 'PUT', authHeaders())

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

// latest sightings of the logged-in user, whatever their status
export const getMySightings = () =>
  request('/api/sightings/mine', { headers: authHeaders() })

// moderators only: { currentTop, items }
export const getPending = () =>
  request('/api/moderation/pending', { headers: authHeaders() })

export const approveSighting = (id) =>
  request(`/api/moderation/${id}/approve`, { method: 'POST', headers: authHeaders() })

export const rejectSighting = (id, reason) =>
  jsonRequest(`/api/moderation/${id}/reject`, { reason }, 'POST', authHeaders())
