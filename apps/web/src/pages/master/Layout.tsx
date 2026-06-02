import { useEffect } from 'react'
import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export default function MasterLayout() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'MASTER') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  if (!isAuthenticated || user?.role !== 'MASTER') return null

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <nav
        style={{
          width: 220,
          background: '#1a1a2e',
          color: '#fff',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16, color: '#a0a8ff' }}>AutoHubs Master</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          <li style={{ marginBottom: 8 }}>
            <Link to="/master/dashboard" style={{ color: '#e0e0e0', textDecoration: 'none' }}>
              Dashboard
            </Link>
          </li>
          <li style={{ marginBottom: 8 }}>
            <Link to="/master/plans" style={{ color: '#e0e0e0', textDecoration: 'none' }}>
              Planos
            </Link>
          </li>
          <li style={{ marginBottom: 8 }}>
            <Link to="/master/organizations" style={{ color: '#e0e0e0', textDecoration: 'none' }}>
              Escritórios
            </Link>
          </li>
        </ul>
        <button
          onClick={handleLogout}
          style={{
            background: 'transparent',
            border: '1px solid #555',
            color: '#ccc',
            padding: '8px',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          Sair
        </button>
      </nav>
      <main style={{ flex: 1, padding: 32, background: '#f9f9f9' }}>
        <Outlet />
      </main>
    </div>
  )
}
