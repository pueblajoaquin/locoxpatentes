// "1d 2h 3m", dropping leading zero units; under a minute shows seconds
const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const TimeRanking = ({ ranking }) => (
  <section className='card'>
    <h2>Time as top</h2>
    {ranking.length === 0
      ? <p>No data yet.</p>
      : (
        <ol>
          {ranking.map((r) => (
            <li key={r.username}>
              {r.username}: {formatDuration(r.totalMs)}
              {r.isCurrentTop && ' (current top)'}
            </li>
          ))}
        </ol>
        )}
  </section>
)

export default TimeRanking
