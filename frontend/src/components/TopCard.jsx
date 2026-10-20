import Plate from './Plate.jsx'
import { formatDate, formatDuration } from '../format.js'

export default function TopCard ({ top, sightings }) {
  if (!top) {
    return (
      <section className='card' id='top'>
        <div className='label'>Current top</div>
        <p className='muted'>There is no top yet. Be the first to submit a plate!</p>
      </section>
    )
  }

  return (
    <>
      <section className='card' id='top'>
        <div className='label'>Current top</div>
        <Plate plate={top.plate} />
        <div className='user-row'>
          <div className='avatar' aria-hidden='true'>{top.user?.[0]?.toUpperCase() ?? '?'}</div>
          <div>
            <strong>{top.user ?? 'Unknown'}</strong>
            <div className='muted'>{formatDate(top.createdAt)}</div>
          </div>
        </div>
        <div className='stats'>
          <div className='stat'>
            <span className='muted'>Time as top</span>
            <span className='stat-value'>{formatDuration(Date.now() - new Date(top.createdAt))}</span>
          </div>
          <div className='stat'>
            <span className='muted'>Sightings</span>
            <span className='stat-value'>{sightings}</span>
          </div>
        </div>
      </section>
      <section className='card photo-card'>
        <img
          className='photo'
          src={top.photoUrl}
          alt={`Photo of license plate ${top.plate} sighted by ${top.user ?? 'an unknown user'}`}
        />
      </section>
    </>
  )
}
