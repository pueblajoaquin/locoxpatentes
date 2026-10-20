import { useAuth } from '../context/AuthContext.jsx'

export default function Header () {
  const { username, logout } = useAuth()

  return (
    <header className='header'>
      <a className='logo' href='#top'>Caza de Patentes</a>
      <nav className='nav'>
        <a href='#top'>Current top</a>
        <a href='#submit'>Submit</a>
        <a href='#rankings'>Rankings</a>
      </nav>
      {username && (
        <button type='button' className='link-button' onClick={logout}>
          {username} · Log out
        </button>
      )}
    </header>
  )
}
