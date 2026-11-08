import { useEffect, useRef, useState } from 'react'

import * as api from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'

// screen for the ?verify= link of the email
export default function VerifyEmail ({ token, onDone }) {
  const { username, markEmailVerified } = useAuth()
  const [status, setStatus] = useState('loading') // 'loading' | 'ok' | 'error'
  const [error, setError] = useState(null)
  // the token is single use and StrictMode runs effects twice in dev: call only once
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    api.verifyEmail(token)
      .then(() => {
        setStatus('ok')
        if (username) markEmailVerified()
      })
      .catch((e) => {
        setError(e.message)
        setStatus('error')
      })
  }, [token, username, markEmailVerified])

  return (
    <section className='card'>
      <div className='label'>Verificar correo</div>
      {status === 'loading' && <p className='muted'>Verificando…</p>}
      {status === 'ok' && <p className='success' role='status'>¡Listo! Tu correo quedó verificado.</p>}
      {status === 'error' && <p className='error' role='alert'>{error}</p>}
      {status !== 'loading' && (
        <button type='button' className='button' onClick={onDone}>
          {username ? 'Volver' : 'Iniciar sesión'}
        </button>
      )}
    </section>
  )
}
