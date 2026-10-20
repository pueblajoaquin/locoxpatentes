const History = ({ history }) => (
  <section className='card'>
    <h2>History</h2>
    {history.length === 0
      ? <p>No data yet.</p>
      : (
        <ul>
          {history.map((h) => (
            <li key={h.plate}>
              {h.plate} — {h.user} ({new Date(h.createdAt).toLocaleString()})
            </li>
          ))}
        </ul>
        )}
  </section>
)

export default History
