import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import * as alert from '@/lib/inbox-alert'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { useInboxStream } from './useInboxStream'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

class FakeEventSource {
  static last: FakeEventSource | null = null
  listeners: Record<string, (e: { data: string }) => void> = {}
  onerror: (() => void) | null = null
  constructor(public url: string) { FakeEventSource.last = this }
  addEventListener(name: string, fn: (e: { data: string }) => void) { this.listeners[name] = fn }
  close() {}
}

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')

beforeEach(() => {
  FakeEventSource.last = null
  vi.stubGlobal('EventSource', FakeEventSource)
  localStorage.setItem('accessToken', `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 900 })}.sig`)
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('opens the bell stream and refreshes the bell (and open conversations) on inbox:changed', async () => {
  server.use(http.post(`${API}/stream/ticket`, () => HttpResponse.json({ ticket: 'tk' })))
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  renderHook(() => useInboxStream(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> })

  await waitFor(() => expect(FakeEventSource.last?.url).toBe(`${API}/notifications/stream?ticket=tk`))
  FakeEventSource.last!.listeners['inbox:changed']({ data: '{}' })
  const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
  expect(keys).toEqual(expect.arrayContaining(['["notifications-unread"]', '["notifications"]', '["comments"]']))
})

it('a new notice rings once and opens its link', async () => {
  server.use(http.post(`${API}/stream/ticket`, () => HttpResponse.json({ ticket: 'tk' })))
  const ring = vi.spyOn(alert, 'alertNewNotification').mockImplementation(() => undefined)
  renderHook(() => useInboxStream(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> })
  await waitFor(() => expect(FakeEventSource.last).not.toBeNull())
  FakeEventSource.last!.listeners['inbox:new']({ data: JSON.stringify({ id: 'n1', title: 'Novo comentário', body: 'Oi', link: '/app/tasks?task=t1' }) })
  expect(ring).toHaveBeenCalledWith({ id: 'n1', title: 'Novo comentário', body: 'Oi', link: '/app/tasks?task=t1' }, expect.any(Function))
})
