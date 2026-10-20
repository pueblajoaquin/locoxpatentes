import { useAuth } from '../context/AuthContext.jsx'

const Header = () => {
  const { username, logout } = useAuth()

  return (
    <header className='header'>
      <h1>Loco x Patentes</h1>
      {username && (
        <div>
          <span>{username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      )}
    </header>
  )
}

export default Header
