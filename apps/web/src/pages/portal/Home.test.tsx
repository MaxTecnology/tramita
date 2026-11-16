import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import PortalHomePage from './Home'

vi.mock('./Layout', () => ({ usePortalClient: () => ({ clientId: 'c1' }) }))

const API = 'http://localhost:3000'

it('two cards going to the same page (documents and messages) render without a duplicated key', async () => {
  server.use(http.get(`${API}/portal/home`, () => HttpResponse.json({
    unpaidGuides: { count: 0, overdueCount: 0 }, documentsToSend: 2, processesInProgress: 1,
    unreadMessages: { count: 0, link: null }, pendingApprovals: 0, pendingApprovalLink: null, dueThisWeek: [],
  })))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><PortalHomePage /></MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Mensagens do escritório')).toBeInTheDocument()
  expect(screen.getByText('Documentos a enviar')).toBeInTheDocument()
  expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
  errors.mockRestore()
})
