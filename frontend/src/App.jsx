import { useCallback, useEffect, useState } from 'react'

import * as api from './api.js'
import Header from './components/Header.jsx'
import ModerationPage from './components/ModerationPage.jsx'
import RankingList from './components/RankingList.jsx'
import ResetPasswordForm from './components/ResetPasswordForm.jsx'
import SubmitCard from './components/SubmitCard.jsx'
import TopCard from './components/TopCard.jsx'
import VerifyEmail from './components/VerifyEmail.jsx'
import { useAuth } from './context/AuthContext.jsx'
import { formatDuration } from './format.js'

// links from the emails: /?verify=<token> or /?reset=<token>
const readLinkFromUrl = () => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('verify')) return { kind: 'verify', token: params.get('verify') }
  if (params.get('reset')) return { kind: 'reset', token: params.get('reset') }
  return null
}

// no router: the moderation panel is the only other view and its links reload the page
const onModeration = window.location.pathname.replace(/\/+$/, '') === '/moderacion'

export default function App () {
  const { username, isModerator } = useAuth()
  const [link, setLink] = useState(readLinkFromUrl)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  // the token is already in state: take it out of the address bar and the history
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [top, ranking, timeRanking] = await Promise.all([
        api.getTop(), api.getRanking(), api.getTimeRanking()
      ])
      setData({ top, ranking, timeRanking })
      setError(null)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'No se pudo conectar con el servidor.' : e.message)
    }
  }, [])

  // the moderation view loads its own data
  useEffect(() => { if (!onModeration) load() }, [load])

  const sightings = data?.ranking.find((r) => r.username === data.top?.user)?.tops ?? 0

  if (link) {
    const closeLink = () => setLink(null)
    return (
      <>
        <Header />
        <main className='page'>
          <div className='row'>
            <div className='narrow'>
              {link.kind === 'verify'
                ? <VerifyEmail token={link.token} onDone={closeLink} />
                : <ResetPasswordForm token={link.token} onDone={closeLink} />}
            </div>
          </div>
        </main>
      </>
    )
  }

  if (onModeration) {
    return (
      <>
        <Header moderation />
        <main className='page'>
          {isModerator
            ? <ModerationPage />
            : (
              <div className='row'>
                <section className='card narrow'>
                  <div className='label'>Moderación</div>
                  <p className='muted'>
                    {username
                      ? 'Esta sección es solo para moderadores.'
                      : 'Iniciá sesión con una cuenta de moderador para ver esta sección.'}
                  </p>
                  <a href='/'>Volver al inicio</a>
                </section>
              </div>
              )}
        </main>
      </>
    )
  }

  return (
    <>
      <Header />
      <main className='page'>
        {error && <p className='error' role='alert'>{error}</p>}
        {!data && !error && <p className='muted'>Cargando…</p>}
        {data && (
          <>
            <div className='row'>
              <TopCard top={data.top} sightings={sightings} />
            </div>
            <div className='row'>
              <div className='narrow'><SubmitCard /></div>
              <section className='card wide' id='rankings'>
                <div className='label'>Rankings</div>
                <div className='rankings'>
                  <RankingList
                    title='Más avistamientos'
                    rows={data.ranking.map((r) => ({ name: r.username, value: r.tops }))}
                  />
                  <RankingList
                    title='Más tiempo como punta'
                    rows={data.timeRanking.map((r) => ({ name: r.username, value: formatDuration(r.totalMs) }))}
                  />
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </>
  )
}
