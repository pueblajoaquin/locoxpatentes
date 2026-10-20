// shows the current top, or a message if there is none yet
const Top = ({ top }) => (
  <section className='card'>
    <h2>The top</h2>
    {top
      ? (
        <>
          <p className='plate'>{top.plate}</p>
          <p>by {top.user}</p>
          <img src={top.photoUrl} alt={top.plate} />
        </>
        )
      : <p>There are no license plates yet. Upload the first one!</p>}
  </section>
)

export default Top
