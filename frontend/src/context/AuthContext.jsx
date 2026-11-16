import { createContext, useContext, useState } from 'react'

import * as api from '../api.js'

const AuthContext = createContext(null)

// stored alongside the token: the username is shown in the header, the email
// state decides whether the user can post sightings and isModerator only
// shows or hides the moderation UI (the backend checks the real permission)
const USERNAME_KEY = 'username'
const EMAIL_VERIFIED_KEY = 'emailVerified'
const HAS_EMAIL_KEY = 'hasEmail'
const IS_MODERATOR_KEY = 'isModerator'

// a missing key reads as false (sessions from before emails existed have no email)
const readFlag = (key) => localStorage.getItem(key) === 'true'

export const AuthProvider = ({ children }) => {
  const [username, setUsername] = useState(localStorage.getItem(USERNAME_KEY))
  const [emailVerified, setEmailVerified] = useState(() => readFlag(EMAIL_VERIFIED_KEY))
  const [hasEmail, setHasEmail] = useState(() => readFlag(HAS_EMAIL_KEY))
  const [isModerator, setIsModerator] = useState(() => readFlag(IS_MODERATOR_KEY))

  const saveEmailState = ({ emailVerified, hasEmail }) => {
    localStorage.setItem(EMAIL_VERIFIED_KEY, String(Boolean(emailVerified)))
    localStorage.setItem(HAS_EMAIL_KEY, String(Boolean(hasEmail)))
    setEmailVerified(Boolean(emailVerified))
    setHasEmail(Boolean(hasEmail))
  }

  const login = async (name, password) => {
    const { token, username: loggedName, emailVerified, hasEmail, isModerator } = await api.login(name, password)
    api.setToken(token)
    localStorage.setItem(USERNAME_KEY, loggedName)
    localStorage.setItem(IS_MODERATOR_KEY, String(Boolean(isModerator)))
    setUsername(loggedName)
    setIsModerator(Boolean(isModerator))
    saveEmailState({ emailVerified, hasEmail })
  }

  // only registers: there is no session until the email is verified
  const register = (name, email, password) => api.register(name, email, password)

  // after setting an email: a verification link is on its way
  const markEmailPending = () => saveEmailState({ emailVerified: false, hasEmail: true })

  // after opening the verification link in a browser with an open session
  const markEmailVerified = () => saveEmailState({ emailVerified: true, hasEmail: true })

  const logout = () => {
    api.clearToken()
    localStorage.removeItem(USERNAME_KEY)
    localStorage.removeItem(EMAIL_VERIFIED_KEY)
    localStorage.removeItem(HAS_EMAIL_KEY)
    localStorage.removeItem(IS_MODERATOR_KEY)
    setUsername(null)
    setEmailVerified(false)
    setHasEmail(false)
    setIsModerator(false)
  }

  return (
    <AuthContext.Provider
      value={{ username, emailVerified, hasEmail, isModerator, login, register, logout, markEmailPending, markEmailVerified }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
