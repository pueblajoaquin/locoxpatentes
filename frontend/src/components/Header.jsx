import { useAuth } from '../context/AuthContext.jsx'

// `moderation`: rendered inside the /moderacion view, where the home anchors don't exist
export default function Header ({ moderation = false }) {
  const { username, isModerator, logout } = useAuth()

  return (
    <header className='header'>
      <a className='logo' href={moderation ? '/' : '#top'}>
        <img className='logo-img' src='/favicon.svg' alt='' />
        LocoxPatentes
      </a>
      <nav className='nav'>
        {moderation
          ? <a href='/'>Inicio</a>
          : (
            <>
              <a href='#top'>Punta actual</a>
              <a href='#submit'>Enviar</a>
              <a href='#rankings'>Rankings</a>
              {isModerator && <a href='/moderacion'>Moderación</a>}
            </>
            )}
      </nav>
      {username && (
        <button type='button' className='link-button' onClick={logout}>
          {username} · Cerrar sesión
        </button>
      )}
    </header>
  )
}
