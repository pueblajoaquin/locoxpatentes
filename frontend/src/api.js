// backend client: all calls go through here

const TOKEN_KEY = 'token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

// does the fetch and throws an Error with the backend message on failure
const request = async (url, options = {}) => {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(data?.error || 'Unexpected error.')
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
