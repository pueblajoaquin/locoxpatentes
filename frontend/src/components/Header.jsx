import { useAuth } from '../context/AuthContext.jsx'

export default function Header () {
  const { username, logout } = useAuth()

  return (
    <header className='header'>
      <a className='logo' href='#top'>
        <img className='logo-img' src='/favicon.svg' alt='' />
        LocoxPatentes
      </a>
      <nav className='nav'>
        <a href='#top'>Punta actual</a>
        <a href='#submit'>Enviar</a>
        <a href='#rankings'>Rankings</a>
      </nav>
      {username && (
        <button type='button' className='link-button' onClick={logout}>
          {username} · Cerrar sesión
        </button>
      )}
    </header>
  )
}
