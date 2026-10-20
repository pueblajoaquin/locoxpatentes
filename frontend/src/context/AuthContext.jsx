import { createContext, useContext, useState } from 'react'

import * as api from '../api.js'

const AuthContext = createContext(null)

// the username is stored alongside the token to show it in the header
const USERNAME_KEY = 'username'

export const AuthProvider = ({ children }) => {
  const [username, setUsername] = useState(localStorage.getItem(USERNAME_KEY))

  const login = async (name, password) => {
    const { token, username: loggedName } = await api.login(name, password)
    api.setToken(token)
    localStorage.setItem(USERNAME_KEY, loggedName)
    setUsername(loggedName)
  }

  // registers and logs in right away
  const register = async (name, password) => {
    await api.register(name, password)
    await login(name, password)
  }

  const logout = () => {
    api.clearToken()
    localStorage.removeItem(USERNAME_KEY)
    setUsername(null)
  }

  return (
    <AuthContext.Provider value={{ username, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
