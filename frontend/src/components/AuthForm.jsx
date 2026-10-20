import { useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'

// single form: toggles between logging in and registering
const AuthForm = () => {
  const { login, register } = useAuth()

  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError(null)

    try {
      if (isRegister) {
        await register(username, password)
      } else {
        await login(username, password)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className='card'>
      <h2>{isRegister ? 'Sign up' : 'Log in'}</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder='Username'
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type='password'
          placeholder='Password'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type='submit'>{isRegister ? 'Create account' : 'Log in'}</button>
      </form>
      {error && <p className='error'>{error}</p>}
      <button className='link' onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? 'I already have an account' : "I don't have an account"}
      </button>
    </section>
  )
}

export default AuthForm
