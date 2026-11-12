import { useCallback, useEffect, useState } from 'react'

import * as api from '../api.js'
import { formatDate } from '../format.js'
import Plate from './Plate.jsx'

const OTHER = 'Otro'
const REASONS = [
  'Foto ilegible',
  'La patente no coincide con la foto',
  'Foto repetida o sacada de internet',
  OTHER
]

// the backend accepts up to 300 characters; leaves room for the predefined reason
const MAX_DETAIL = 250

function PendingItem ({ item, busy, onApprove, onReject }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState(REASONS[0])
  const [detail, setDetail] = useState('')

  const detailRequired = reason === OTHER
  const trimmed = detail.trim()

  const submitReject = (event) => {
    event.preventDefault()
    if (detailRequired) return onReject(item.id, trimmed)
    onReject(item.id, trimmed ? `${reason}. ${trimmed}` : reason)
  }

  return (
    <section className='card mod-item'>
      <a className='mod-photo' href={item.photoUrl} target='_blank' rel='noreferrer' title='Abrir la foto en una pestaña nueva'>
        <img src={item.photoUrl} alt={`Foto enviada para la patente ${item.plate}`} />
      </a>
      <div className='mod-info'>
        <Plate plate={item.plate} />
        <div className='mod-meta'>
          <strong>{item.user ?? 'Desconocido'}</strong>
          <span className='muted'>{formatDate(item.createdAt)}</span>
          {!item.newerThanTop && <span className='badge superseded'>Ya superada</span>}
        </div>

        {item.isOwn && <p className='muted'>No podés moderar tus envíos.</p>}

        {!rejecting && (
          <div className='actions'>
            <button type='button' className='button' disabled={busy || item.isOwn} onClick={() => onApprove(item.id)}>
              Aprobar
            </button>
            <button type='button' className='button danger' disabled={busy || item.isOwn} onClick={() => setRejecting(true)}>
              Rechazar
            </button>
          </div>
        )}

        {rejecting && (
          <form onSubmit={submitReject}>
            <label htmlFor={`reason-${item.id}`}>Motivo del rechazo</label>
            <select id={`reason-${item.id}`} className='input' value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <label htmlFor={`detail-${item.id}`}>{detailRequired ? 'Detalle' : 'Detalle (opcional)'}</label>
            <textarea
              id={`detail-${item.id}`}
              className='input'
              rows={3}
              maxLength={MAX_DETAIL}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              required={detailRequired}
            />
            <div className='actions'>
              <button className='button danger' disabled={busy || (detailRequired && !trimmed)}>
                Confirmar rechazo
              </button>
              <button type='button' className='button secondary' disabled={busy} onClick={() => setRejecting(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

export default function ModerationPage () {
  const [queue, setQueue] = useState(null) // { currentTop, items }
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setQueue(await api.getPending())
      return true
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message)
      return false
    }
  }, [])

  useEffect(() => { load() }, [load])

  // runs the action and reloads the queue either way: on a failure (already
  // decided, superseded) the list on screen is stale too
  const act = async (action) => {
    setBusy(true)
    setError(null)
    let failure = null
    try {
      await action()
    } catch (e) {
      failure = e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message
    }
    await load()
    if (failure) setError(failure)
    setBusy(false)
  }

  const approve = (id) => act(() => api.approveSighting(id))
  const reject = (id, reason) => act(() => api.rejectSighting(id, reason))

  return (
    <>
      <div className='row'>
        <section className='card narrow'>
          <div className='label'>Punta actual</div>
          {queue?.currentTop && <Plate plate={queue.currentTop} />}
          {queue && !queue.currentTop && <p className='muted'>Todavía no hay punta.</p>}
          {!queue && !error && <p className='muted'>Cargando…</p>}
        </section>
        <section className='card wide'>
          <div className='label'>Moderación</div>
          {queue && (
            <p className='muted'>
              {queue.items.length === 0
                ? 'No hay envíos pendientes.'
                : `${queue.items.length} ${queue.items.length === 1 ? 'envío pendiente' : 'envíos pendientes'}, del más viejo al más nuevo.`}
            </p>
          )}
          {error && <p className='error' role='alert'>{error}</p>}
          <button type='button' className='link-button' disabled={busy} onClick={() => { setError(null); load() }}>
            Actualizar
          </button>
        </section>
      </div>
      {queue?.items.map((item) => (
        <PendingItem key={item.id} item={item} busy={busy} onApprove={approve} onReject={reject} />
      ))}
    </>
  )
}
