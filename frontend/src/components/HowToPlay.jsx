import { Fragment, useEffect, useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'
import Plate from './Plate.jsx'

const ANCHOR = '#como-jugar'

// fixed examples, oldest to newest: each step is a rollover, so the plate that "looks smaller"
// is the newer one (ZZ -> number + 1 -> AA, then the first letters beat any number)
const EXAMPLE_PLATES = ['AF345ZZ', 'AF346AA', 'AG000AA']
// longer sequence behind "Ver más ejemplos", from the very first plate
const MORE_PLATES = ['AA000AA', 'AA000AB', 'AA000ZZ', 'AA001AA', 'AA999AA', 'AB000AA']

function PlateSequence ({ plates, className = 'plate-examples' }) {
  return (
    <div className={className}>
      {plates.map((plate, i) => (
        <Fragment key={plate}>
          {i > 0 && <span className='plate-sign' aria-hidden='true'>{'<'}</span>}
          <div className='plate-example'><Plate plate={plate} /></div>
        </Fragment>
      ))}
    </div>
  )
}

export default function HowToPlay () {
  const { username } = useAuth()
  // open for visitors, collapsed for logged in players; nothing is stored
  const [open, setOpen] = useState(!username)

  // the header link opens the block even when it is collapsed
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === ANCHOR) setOpen(true)
    }
    // a second click on the link doesn't change the hash, so there is no hashchange
    const openFromClick = (e) => {
      if (e.target.closest?.(`a[href="${ANCHOR}"]`)) setOpen(true)
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    document.addEventListener('click', openFromClick)
    return () => {
      window.removeEventListener('hashchange', openFromHash)
      document.removeEventListener('click', openFromClick)
    }
  }, [])

  return (
    <section className='card how' id='como-jugar'>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className='label'>Cómo se juega</summary>
        <ol className='steps'>
          <li className='step'>
            <span className='step-num' aria-hidden='true'>1</span>
            <h3>Encontrá una patente más nueva que la punta</h3>
            <p className='muted'>
              Las patentes salen en orden: primero avanzan las dos letras finales, después el
              número y al final las dos letras iniciales.
            </p>
            <PlateSequence plates={EXAMPLE_PLATES} />
            <details className='more-examples'>
              <summary>Ver más ejemplos</summary>
              <PlateSequence plates={MORE_PLATES} className='plate-examples wrap' />
            </details>
          </li>
          <li className='step'>
            <span className='step-num' aria-hidden='true'>2</span>
            <h3>Sacale una foto y enviala</h3>
            <p className='muted'>
              Necesitás una cuenta con el correo verificado. Podés tener hasta 3 envíos
              pendientes a la vez.
            </p>
          </li>
          <li className='step'>
            <span className='step-num' aria-hidden='true'>3</span>
            <h3>Un moderador la revisa</h3>
            <p className='muted'>
              Si la aprueba, pasás a ser la punta y sumás en los rankings de avistamientos y de
              tiempo como punta. Si antes aprueban una más nueva, la tuya queda superada.
            </p>
          </li>
        </ol>
        {!username && <a className='how-cta' href='#submit'>Creá tu cuenta y empezá</a>}
      </details>
    </section>
  )
}
