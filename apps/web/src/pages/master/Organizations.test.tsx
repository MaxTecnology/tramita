import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import MasterOrganizations from './Organizations'

const API = 'http://localhost:3000'
const org = (id: string, name: string, billingMode: string, manualNextDueDate: string | null) => ({
  id, name, email: `${id}@t.com`, subscriptionStatus: 'ACTIVE', planName: 'Pro', clientsCount: 1, usersCount: 1, billingMode, manualNextDueDate,
})

function renderPage() {
  let created: Record<string, unknown> | null = null
  server.use(
    http.get(`${API}/master/organizations`, () => HttpResponse.json([org('o1', 'Via Asaas', 'ASAAS', null), org('o2', 'Acerto', 'MANUAL', '2099-12-10T00:00:00.000Z')])),
    http.get(`${API}/organizations/plans`, () => HttpResponse.json([{ id: 'p1', name: 'Pro', priceMonthly: 197 }])),
    http.post(`${API}/master/organizations`, async ({ request }) => { created = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ temporaryPassword: 'abc' }, { status: 201 }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><MasterOrganizations /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { created: () => created }
}

it('the list shows how each office pays', async () => {
  renderPage()
  const row = (await screen.findByText('Acerto')).closest('tr')!
  expect(within(row).getByText('Acerto direto')).toBeInTheDocument()
  expect(within(row).getByText('vence 10/12/2099')).toBeInTheDocument()
  expect(within(screen.getByText('Via Asaas').closest('tr')!).getByText('Asaas')).toBeInTheDocument()
})

it('an office without Asaas is created as a direct agreement with its next due date', async () => {
  const { created } = renderPage()
  await userEvent.click(await screen.findByRole('button', { name: '+ Criar organização' }))
  await userEvent.type(screen.getByLabelText(/Nome do escritório/), 'Contábil X')
  await userEvent.type(screen.getByLabelText(/E-mail/), 'x@x.com')
  await screen.findByRole('option', { name: /Pro/ })
  await userEvent.selectOptions(screen.getByLabelText(/Plano/), 'p1')
  await userEvent.type(screen.getByLabelText(/Nome do administrador/), 'Ana')
  await userEvent.type(screen.getByLabelText('Próximo vencimento do acerto'), '2026-12-10')
  await userEvent.click(screen.getByRole('button', { name: 'Criar' }))
  await waitFor(() => expect(created()).toMatchObject({ createAsaasSubscription: false, manualNextDueDate: '2026-12-10' }))
})
