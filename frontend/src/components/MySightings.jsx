import { useEffect, useState } from 'react'

import * as api from '../api.js'
import { formatDate, formatPlate } from '../format.js'

const STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  superseded: 'Superada'
}

// latest sightings of the logged-in user; `refreshKey` changes after each new submission
export default function MySightings ({ refreshKey }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.getMySightings()
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message === 'Failed to fetch' ? 'No se pudieron cargar tus envíos.' : e.message)
      })
    return () => { cancelled = true }
  }, [refreshKey])

  return (
    <div className='my-sightings'>
      <h3>Mis envíos</h3>
      {error && <p className='error' role='alert'>{error}</p>}
      {!items && !error && <p className='muted'>Cargando…</p>}
      {items?.length === 0 && <p className='muted'>Todavía no enviaste ninguna patente.</p>}
      {items?.length > 0 && (
        <ul>
          {items.map((s) => (
            <li key={s.id}>
              <div className='my-sighting-main'>
                <span className='value'>{formatPlate(s.plate)}</span>
                <span className='muted help'>{formatDate(s.createdAt)}</span>
                {s.status === 'rejected' && s.rejectReason && (
                  <span className='muted help'>Motivo: {s.rejectReason}</span>
                )}
              </div>
              <span className={`badge ${s.status}`}>{STATUS_LABELS[s.status] ?? s.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
