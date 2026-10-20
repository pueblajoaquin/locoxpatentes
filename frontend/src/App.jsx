import { useCallback, useEffect, useState } from 'react'

import * as api from './api.js'
import { useAuth } from './context/AuthContext.jsx'
import Header from './components/Header.jsx'
import AuthForm from './components/AuthForm.jsx'
import Top from './components/Top.jsx'
import SubmitSighting from './components/SubmitSighting.jsx'
import Ranking from './components/Ranking.jsx'
import TimeRanking from './components/TimeRanking.jsx'
import History from './components/History.jsx'

const App = () => {
  const { username } = useAuth()

  const [top, setTop] = useState(null)
  const [ranking, setRanking] = useState([])
  const [timeRanking, setTimeRanking] = useState([])
  const [history, setHistory] = useState([])

  // reloads the whole game state; called on startup and after each upload
  const refresh = useCallback(async () => {
    const [newTop, newRanking, newTimeRanking, newHistory] = await Promise.all([
      api.getTop(),
      api.getRanking(),
      api.getTimeRanking(),
      api.getHistory()
    ])
    setTop(newTop)
    setRanking(newRanking)
    setTimeRanking(newTimeRanking)
    setHistory(newHistory)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <>
      <Header />
      <main>
        <Top top={top} />
        {username
          ? <SubmitSighting onSubmitted={refresh} />
          : <AuthForm />}
        <div className='rankings'>
          <Ranking ranking={ranking} />
          <TimeRanking ranking={timeRanking} />
        </div>
        <History history={history} />
      </main>
    </>
  )
}

export default App
