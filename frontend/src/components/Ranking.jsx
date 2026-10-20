const Ranking = ({ ranking }) => (
  <section className='card'>
    <h2>Most tops</h2>
    {ranking.length === 0
      ? <p>No data yet.</p>
      : (
        <ol>
          {ranking.map((r) => (
            <li key={r.username}>{r.username}: {r.tops}</li>
          ))}
        </ol>
        )}
  </section>
)

export default Ranking
