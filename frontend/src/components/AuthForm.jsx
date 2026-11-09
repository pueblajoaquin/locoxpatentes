import { useState } from 'react'

import * as api from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import VerificationNotice from './VerificationNotice.jsx'

const INTROS = {
  login: 'Iniciá sesión para enviar un avistamiento.',
  register: 'Creá tu cuenta. Te vamos a mandar un correo para verificarla.',
  forgot: 'Ingresá tu correo y te mandamos un link para cambiar la contraseña.'
}

const SUBMIT_LABELS = {
  login: 'Iniciar sesión',
  register: 'Registrarme',
  forgot: 'Enviar link'
}

export default function AuthForm () {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  // pending verification: { email } ('' when unknown, the notice asks for it)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  const changeMode = (next) => {
    setMode(next)
    setError(null)
    setMessage(null)
    setPending(null)
  }

  const submitLogin = async () => {
    try {
      await login(name.trim(), password)
    } catch (e) {
      if (e.status === 403 && e.data?.error === 'email not verified') {
        setPending({ email: pending?.email ?? '' })
        return
      }
      throw e
    }
  }

  const submitRegister = async () => {
    const trimmedEmail = email.trim()
    await register(name.trim(), trimmedEmail, password)
    setMode('login')
    setPassword('')
    setPending({ email: trimmedEmail })
  }

  const submitForgot = async () => {
    await api.forgotPassword(email.trim())
    setMessage('Si el correo existe, te enviamos un link para cambiar la contraseña.')
  }

  const HANDLERS = { login: submitLogin, register: submitRegister, forgot: submitForgot }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await HANDLERS[mode]()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {pending && <VerificationNotice key={pending.email} email={pending.email || undefined} />}
      <form onSubmit={submit}>
        <p className='muted'>{INTROS[mode]}</p>

        {mode !== 'forgot' && (
          <>
            <label htmlFor='auth-name'>Usuario</label>
            <input id='auth-name' className='input' value={name} onChange={(e) => setName(e.target.value)} autoComplete='username' required />
          </>
        )}

        {mode !== 'login' && (
          <>
            <label htmlFor='auth-email'>Correo</label>
            <input id='auth-email' className='input' type='email' value={email} onChange={(e) => setEmail(e.target.value)} autoComplete='email' required />
          </>
        )}

        {mode !== 'forgot' && (
          <>
            <label htmlFor='auth-password'>Contraseña</label>
            <input id='auth-password' className='input' type='password' value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </>
        )}

        {error && <p className='error' role='alert'>{error}</p>}
        {message && <p className='success' role='status'>{message}</p>}
        <button className='button' disabled={busy}>{SUBMIT_LABELS[mode]}</button>

        <div className='form-links'>
          {mode === 'login' && (
            <>
              <button type='button' className='link-button' onClick={() => changeMode('register')}>¿No tenés cuenta? Registrate</button>
              <button type='button' className='link-button' onClick={() => changeMode('forgot')}>¿Olvidaste tu contraseña?</button>
            </>
          )}
          {mode !== 'login' && (
            <button type='button' className='link-button' onClick={() => changeMode('login')}>¿Ya tenés cuenta? Iniciá sesión</button>
          )}
        </div>
      </form>
    </>
  )
}
