import { useMemo } from 'react'

interface StoredUser {
  id: string
  name: string
  role: string
  organizationId: string | null
  orgName: string | null
}

export function useAuth() {
  const user = useMemo<StoredUser | null>(() => {
    try {
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw) as StoredUser) : null
    } catch {
      return null
    }
  }, [])

  const isAuthenticated = !!localStorage.getItem('accessToken')

  function logout() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
  }

  return { user, isAuthenticated, logout }
}
