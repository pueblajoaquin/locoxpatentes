import { useState } from 'react'

import * as api from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import AuthForm from './AuthForm.jsx'
import MySightings from './MySightings.jsx'
import VerificationNotice from './VerificationNotice.jsx'

// logged in without a verified email (e.g. accounts from before emails existed)
function AddEmailForm () {
  const { hasEmail, markEmailPending } = useAuth()
  const [email, setEmail] = useState('')
  // email the link was sent to in this session; null shows the form
  const [sentTo, setSentTo] = useState(null)
  // with an email already pending, start on the notice instead of the form
  const [editing, setEditing] = useState(!hasEmail)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const trimmed = email.trim()
      await api.setEmail(trimmed)
      markEmailPending()
      setSentTo(trimmed)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <>
        <VerificationNotice
          key={sentTo ?? ''}
          email={sentTo ?? undefined}
          text='Te enviamos un correo. Abrí el link para habilitar los envíos.'
        />
        <button type='button' className='link-button' onClick={() => setEditing(true)}>Usar otro correo</button>
      </>
    )
  }

  return (
    <form onSubmit={submit}>
      <p className='muted'>Agregá y verificá tu correo para enviar avistamientos.</p>
      <label htmlFor='add-email'>Correo</label>
      <input id='add-email' className='input' type='email' value={email} onChange={(e) => setEmail(e.target.value)} autoComplete='email' required />
      {error && <p className='error' role='alert'>{error}</p>}
      <button className='button' disabled={busy}>{busy ? 'Enviando…' : 'Enviar verificación'}</button>
      {hasEmail && (
        <button type='button' className='link-button' onClick={() => setEditing(false)}>Cancelar</button>
      )}
    </form>
  )
}

export default function SubmitCard () {
  const { username, emailVerified, markEmailPending } = useAuth()
  // bumped after each submission so "Mis envíos" reloads
  const [sent, setSent] = useState(0)
  const [plate, setPlate] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, text }

  const submit = async (event) => {
    event.preventDefault()
    const form = event.target
    setBusy(true)
    setResult(null)
    try {
      const normalized = plate.replace(/[\s-]/g, '').toUpperCase()
      await api.postSighting(normalized, photo)
      // the top doesn't change until a moderator approves it: only the user's list does
      setResult({ ok: true, text: 'Enviado. Queda pendiente de moderación.' })
      setPlate('')
      setPhoto(null)
      form.reset()
      setSent((n) => n + 1)
    } catch (e) {
      // the stored flag was stale (e.g. the email changed elsewhere): show the email form
      if (e.status === 403 && e.data?.error === 'email verification required') {
        markEmailPending()
        return
      }
      setResult({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='card' id='submit'>
      <div className='label'>Enviar avistamiento</div>
      {!username && <AuthForm />}
      {username && !emailVerified && <AddEmailForm />}
      {username && emailVerified && (
        <form onSubmit={submit}>
          <label htmlFor='plate'>Patente</label>
          <input
            id='plate'
            className='plate-input'
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder='AB 123 CD'
            maxLength={10}
            autoComplete='off'
            required
          />
          <label htmlFor='photo'>Foto</label>
          <input
            id='photo'
            className='file-input'
            type='file'
            accept='image/jpeg,image/png,image/webp'
            onChange={(e) => setPhoto(e.target.files[0] ?? null)}
            required
          />
          <p className='muted help'>Solo cuenta si es más nueva que la punta actual y un moderador la aprueba.</p>
          {result && <p className={result.ok ? 'success' : 'error'} role='alert'>{result.text}</p>}
          <button className='button' disabled={busy || !photo}>{busy ? 'Enviando…' : 'Enviar'}</button>
        </form>
      )}
      {username && emailVerified && <MySightings refreshKey={sent} />}
    </section>
  )
}
