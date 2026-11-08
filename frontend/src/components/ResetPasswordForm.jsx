import { useState } from 'react'

import * as api from '../api.js'

// screen for the ?reset= link of the email
export default function ResetPasswordForm ({ token, onDone }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setBusy(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='card'>
      <div className='label'>Nueva contraseña</div>
      {done
        ? (
          <>
            <p className='success' role='status'>Contraseña actualizada. Ya podés iniciar sesión.</p>
            <button type='button' className='button' onClick={onDone}>Iniciar sesión</button>
          </>
          )
        : (
          <form onSubmit={submit}>
            <label htmlFor='reset-password'>Nueva contraseña</label>
            <input id='reset-password' className='input' type='password' value={password} onChange={(e) => setPassword(e.target.value)} autoComplete='new-password' required />
            <label htmlFor='reset-confirmation'>Repetí la contraseña</label>
            <input id='reset-confirmation' className='input' type='password' value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete='new-password' required />
            {error && <p className='error' role='alert'>{error}</p>}
            <button className='button' disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button>
            <button type='button' className='link-button' onClick={onDone}>Cancelar</button>
          </form>
          )}
    </section>
  )
}
