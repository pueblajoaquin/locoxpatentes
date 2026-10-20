import { useCallback, useEffect, useState } from 'react'

import * as api from './api.js'
import Header from './components/Header.jsx'
import RankingList from './components/RankingList.jsx'
import SubmitCard from './components/SubmitCard.jsx'
import TopCard from './components/TopCard.jsx'
import { formatDuration } from './format.js'

export default function App () {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const [top, ranking, timeRanking] = await Promise.all([
        api.getTop(), api.getRanking(), api.getTimeRanking()
      ])
      setData({ top, ranking, timeRanking })
      setError(null)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'Could not reach the server.' : e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const sightings = data?.ranking.find((r) => r.username === data.top?.user)?.tops ?? 0

  return (
    <>
      <Header />
      <main className='page'>
        {error && <p className='error' role='alert'>{error}</p>}
        {!data && !error && <p className='muted'>Loading…</p>}
        {data && (
          <>
            <div className='row'>
              <TopCard top={data.top} sightings={sightings} />
            </div>
            <div className='row'>
              <div className='narrow'><SubmitCard onSubmitted={load} /></div>
              <section className='card wide' id='rankings'>
                <div className='label'>Rankings</div>
                <div className='rankings'>
                  <RankingList
                    title='Most sightings'
                    rows={data.ranking.map((r) => ({ name: r.username, value: r.tops }))}
                  />
                  <RankingList
                    title='Most time as top'
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
