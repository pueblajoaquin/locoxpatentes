import { useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'

export default function AuthForm () {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await (mode === 'login' ? login : register)(name.trim(), password)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <p className='muted'>Log in to submit a sighting.</p>
      <label htmlFor='auth-name'>Username</label>
      <input id='auth-name' className='input' value={name} onChange={(e) => setName(e.target.value)} autoComplete='username' required />
      <label htmlFor='auth-password'>Password</label>
      <input id='auth-password' className='input' type='password' value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
      {error && <p className='error' role='alert'>{error}</p>}
      <button className='button' disabled={busy}>{mode === 'login' ? 'Log in' : 'Sign up'}</button>
      <button type='button' className='link-button' onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
      </button>
    </form>
  )
}
