import { useState } from 'react'

import * as api from '../api.js'
import { useAuth } from '../context/AuthContext.jsx'
import AuthForm from './AuthForm.jsx'

export default function SubmitCard ({ onSubmitted }) {
  const { username } = useAuth()
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
      setResult({ ok: true, text: '¡Sos la nueva punta!' })
      setPlate('')
      setPhoto(null)
      form.reset()
      onSubmitted()
    } catch (e) {
      setResult({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='card' id='submit'>
      <div className='label'>Enviar avistamiento</div>
      {!username
        ? <AuthForm />
        : (
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
            <p className='muted help'>Solo cuenta si es más nueva que la punta actual. Si lo es, te convertís en la nueva punta.</p>
            {result && <p className={result.ok ? 'success' : 'error'} role='alert'>{result.text}</p>}
            <button className='button' disabled={busy || !photo}>{busy ? 'Enviando…' : 'Enviar'}</button>
          </form>
          )}
    </section>
  )
}
