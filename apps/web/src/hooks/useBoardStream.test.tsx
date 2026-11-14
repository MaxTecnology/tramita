import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { useBoardStream } from './useBoardStream'

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
  vi.stubGlobal('EventSource', FakeEventSource)
  localStorage.setItem('accessToken', `${b64({ alg: 'RS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 900 })}.sig`)
  server.use(http.post(`${API}/stream/ticket`, () => HttpResponse.json({ ticket: 'tk' })))
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

it('a change on the board refreshes the open task panel (documents, history, comments, approvals, attachments)', async () => {
  const qc = new QueryClient()
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  renderHook(() => useBoardStream('b1'), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> })
  await waitFor(() => expect(FakeEventSource.last?.url).toBe(`${API}/boards/b1/stream?ticket=tk`))
  FakeEventSource.last!.listeners['task:updated']({ data: JSON.stringify({ taskId: 't1' }) })
  const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
  expect(keys).toEqual(expect.arrayContaining([
    '["board","b1"]', '["tasks"]', '["task-documents","t1"]', '["task-history","t1"]', '["comments","t1"]', '["task-approvals","t1"]', '["attachments","t1"]',
  ]))
})
