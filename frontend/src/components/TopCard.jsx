import Plate from './Plate.jsx'
import { formatDate, formatDuration } from '../format.js'

export default function TopCard ({ top, sightings }) {
  if (!top) {
    return (
      <section className='card' id='top'>
        <div className='label'>Punta actual</div>
        <p className='muted'>Todavía no hay punta. ¡Sé el primero en enviar una patente!</p>
      </section>
    )
  }

  return (
    <>
      <section className='card' id='top'>
        <div className='label'>Punta actual</div>
        <Plate plate={top.plate} />
        <div className='user-row'>
          <div className='avatar' aria-hidden='true'>{top.user?.[0]?.toUpperCase() ?? '?'}</div>
          <div>
            <strong>{top.user ?? 'Desconocido'}</strong>
            <div className='muted'>{formatDate(top.createdAt)}</div>
          </div>
        </div>
        <div className='stats'>
          <div className='stat'>
            <span className='muted'>Tiempo como punta</span>
            <span className='stat-value'>{formatDuration(Date.now() - new Date(top.createdAt))}</span>
          </div>
          <div className='stat'>
            <span className='muted'>Avistamientos</span>
            <span className='stat-value'>{sightings}</span>
          </div>
        </div>
      </section>
      <section className='card photo-card'>
        <img
          className='photo'
          src={top.photoUrl}
          alt={`Foto de la patente ${top.plate} avistada por ${top.user ?? 'un usuario desconocido'}`}
        />
      </section>
    </>
  )
}
