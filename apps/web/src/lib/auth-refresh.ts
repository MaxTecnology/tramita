import axios from 'axios'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// Refresh a bit before the real expiry so a token never dies mid-request.
const EXPIRY_SKEW_SECONDS = 30

let inflight: Promise<string> | null = null

export function isTokenExpired(token: string, skewSeconds = EXPIRY_SKEW_SECONDS): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return true
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const { exp } = JSON.parse(json) as { exp?: number }
    if (typeof exp !== 'number') return true
    return exp - skewSeconds <= Date.now() / 1000
  } catch {
    return true
  }
}

export function clearSession(): void {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
}

export function redirectToLogin(): void {
  clearSession()
  window.location.href = '/login'
}

// Single-flight: concurrent callers (several 401s at once, SSE reconnects) share one
// /auth/refresh call. Required before refresh-token rotation, which would otherwise
// invalidate the session when two refreshes race.
export function refreshAccessToken(): Promise<string> {
  if (inflight) return inflight

  inflight = (async () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) throw new Error('No refresh token')
    try {
      const { data } = await axios.post<{ accessToken: string }>(`${API_URL}/auth/refresh`, { refreshToken })
      localStorage.setItem('accessToken', data.accessToken)
      return data.accessToken
    } catch (err) {
      clearSession()
      throw err
    }
  })().finally(() => {
    inflight = null
  })

  return inflight
}

// For EventSource, which cannot see a 401 nor send headers: hand out a token that is
// known to be valid, refreshing first when the stored one expired (tab left idle).
export async function getFreshAccessToken(): Promise<string | null> {
  const token = localStorage.getItem('accessToken')
  if (!token) return null
  if (!isTokenExpired(token)) return token
  return refreshAccessToken()
}
