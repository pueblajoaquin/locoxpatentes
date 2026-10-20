export default function RankingList ({ title, rows }) {
  return (
    <div className='ranking'>
      <h3>{title}</h3>
      {rows.length === 0
        ? <p className='muted'>Todavía no hay nada.</p>
        : (
          <ol>
            {rows.slice(0, 5).map((row, i) => (
              <li key={row.name}>
                <span className={i === 0 ? 'pos first' : 'pos'}>{i + 1}</span>
                <span className='name'>{row.name}</span>
                <span className='value'>{row.value}</span>
              </li>
            ))}
          </ol>
          )}
    </div>
  )
}
