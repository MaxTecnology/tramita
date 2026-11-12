import { render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import UnpaidGuides from './UnpaidGuides'

const API = 'http://localhost:3000'
const base = { number: '2026-000001', clientId: 'c1', clientName: 'ACME LTDA', departmentName: 'Fiscal', competence: '2026-10-01T00:00:00.000Z', paidAt: null, paidAmount: null, paidByName: null, boardId: 'b1' }

function renderPage() {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'X', role: 'ORG_ADMIN', organizationId: 'o1', orgName: 'G2A' }))
  server.use(
    http.get(`${API}/protocols/unpaid`, () => HttpResponse.json([
      { ...base, id: 'p1', title: 'Guia DAS', dueDate: '2026-11-10T00:00:00.000Z', amount: '1234.56', overdue: true },
      { ...base, id: 'p2', title: 'Guia FGTS', dueDate: '2026-11-20T00:00:00.000Z', amount: '100', overdue: false },
    ])),
    http.get(`${API}/clients`, () => HttpResponse.json([])),
    http.get(`${API}/departments`, () => HttpResponse.json([])),
  )
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><UnpaidGuides /></MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => localStorage.clear())

it('renders the overdue guide before the upcoming one with the amount in BRL', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText('Guia DAS')).toBeInTheDocument())

  const rows = screen.getAllByTestId('guide-row')
  expect(within(rows[0]).getByText('Guia DAS')).toBeInTheDocument()
  expect(within(rows[0]).getByText('R$ 1.234,56')).toBeInTheDocument()
  expect(within(rows[0]).getByText('Vencida')).toBeInTheDocument()
  expect(within(rows[1]).getByText('Guia FGTS')).toBeInTheDocument()
  expect(within(rows[1]).getByText('R$ 100,00')).toBeInTheDocument()
})
