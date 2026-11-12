import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { useRequestsBadgeStream } from './useRequestsBadgeStream'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

class FakeEventSource {
  static urls: string[] = []
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeEventSource.urls.push(url) }
  addEventListener() {}
  close() {}
}

function jwtWithExp(expSecondsFromNow: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeEach(() => {
  FakeEventSource.urls = []
  vi.stubGlobal('EventSource', FakeEventSource)
  localStorage.clear()
})

afterEach(() => vi.unstubAllGlobals())

it('refreshes an expired token before opening the stream (tab left idle)', async () => {
  const fresh = jwtWithExp(900)
  localStorage.setItem('accessToken', jwtWithExp(-60))
  localStorage.setItem('refreshToken', 'r1')
  const refreshCalls = vi.fn()
  server.use(
    http.post(`${API}/auth/refresh`, () => {
      refreshCalls()
      return HttpResponse.json({ accessToken: fresh })
    }),
  )

  renderHook(() => useRequestsBadgeStream(), { wrapper })

  await waitFor(() => expect(FakeEventSource.urls).toHaveLength(1))
  expect(FakeEventSource.urls[0]).toBe(`${API}/requests/stream?token=${fresh}`)
  expect(refreshCalls).toHaveBeenCalledTimes(1)
})

it('opens the stream with the stored token while it is still valid', async () => {
  const valid = jwtWithExp(900)
  localStorage.setItem('accessToken', valid)

  renderHook(() => useRequestsBadgeStream(), { wrapper })

  await waitFor(() => expect(FakeEventSource.urls).toHaveLength(1))
  expect(FakeEventSource.urls[0]).toBe(`${API}/requests/stream?token=${valid}`)
})
