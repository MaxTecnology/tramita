import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import PortalRequests from './Requests'

vi.mock('./Layout', () => ({ usePortalClient: () => ({ clientId: 'c1', clients: [{ id: 'c1', name: 'ACME' }], setClientId: () => undefined }) }))

const API = 'http://localhost:3000'

it('a notification link scrolls to the request once, not again on every render', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  server.use(
    http.get(`${API}/portal/requests`, () => HttpResponse.json([
      { id: 'r1', title: 'Alterar endereço', description: null, status: 'PENDING', createdAt: '2026-11-10T12:00:00.000Z', department: { id: 'd1', name: 'Fiscal' }, comments: [] },
    ])),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/portal/requests?request=r1']}><PortalRequests /></MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByText('Alterar endereço')).toBeInTheDocument())
  await waitFor(() => expect(scroll).toHaveBeenCalled())
  await userEvent.click(screen.getByRole('button', { name: /Nova solicitação/ }))
  await userEvent.type(screen.getByLabelText('Título'), 'Outra coisa')
  expect(scroll).toHaveBeenCalledTimes(1)
})
