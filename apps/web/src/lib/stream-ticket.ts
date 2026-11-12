import { api } from './api'
import { getFreshAccessToken } from './auth-refresh'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

// The session could not be refreshed: the caller sends the user to login.
export class StreamAuthError extends Error {}

// EventSource can't send headers: trade the (fresh) access token for a one-time ticket that opens
// a single stream connection, so the JWT never shows up in a URL. Returns null when logged out;
// any other failure (network, 5xx) is transient and the caller retries with backoff.
export async function openStreamUrl(path: string): Promise<string | null> {
  let token: string | null
  try {
    token = await getFreshAccessToken()
  } catch {
    throw new StreamAuthError()
  }
  if (!token) return null
  const { data } = await api.post<{ ticket: string }>('/stream/ticket')
  return `${BASE_URL}${path}?ticket=${encodeURIComponent(data.ticket)}`
}
