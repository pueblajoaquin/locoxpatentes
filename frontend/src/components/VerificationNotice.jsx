import { useState } from 'react'

import * as api from '../api.js'

// "check your inbox" notice with a resend button; asks for the email when it isn't known
export default function VerificationNotice ({ email: knownEmail, text = 'Te enviamos un correo para verificar tu cuenta.' }) {
  const [email, setEmail] = useState(knownEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text }

  const resend = async (event) => {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      await api.resendVerification(email.trim())
      setResult({ ok: true, text: 'Si el correo está registrado y pendiente, te enviamos un link nuevo.' })
    } catch (e) {
      setResult({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className='notice' onSubmit={resend}>
      <p>{text}</p>
      {knownEmail
        ? <p className='muted help'>Revisá <strong>{knownEmail}</strong> (y la carpeta de spam).</p>
        : (
          <>
            <label htmlFor='notice-email'>Correo</label>
            <input id='notice-email' className='input' type='email' value={email} onChange={(e) => setEmail(e.target.value)} autoComplete='email' required />
          </>
          )}
      {result && <p className={result.ok ? 'success' : 'error'} role='alert'>{result.text}</p>}
      <button className='button' disabled={busy}>{busy ? 'Enviando…' : 'Reenviar correo'}</button>
    </form>
  )
}
