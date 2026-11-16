import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import MasterOrganizationDetail from './OrganizationDetail'

const API = 'http://localhost:3000'

function renderDetail(billingMode: 'ASAAS' | 'MANUAL') {
  let patched: unknown = null
  server.use(
    http.get(`${API}/master/organizations/o1`, () => HttpResponse.json({
      id: 'o1', name: 'Contábil X', email: 'x@x.com', planName: 'Pro', subscriptionStatus: 'ACTIVE', clientsCount: 1, usersCount: 1, users: [],
      billingMode, manualNextDueDate: billingMode === 'MANUAL' ? '2099-12-10T00:00:00.000Z' : null,
    })),
    http.patch(`${API}/master/organizations/o1`, async ({ request }) => { patched = await request.json(); return HttpResponse.json({}) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/master/organizations/o1']}>
        <Routes><Route path="/master/organizations/:id" element={<MasterOrganizationDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { patched: () => patched }
}

it('a direct agreement moves its next due date', async () => {
  const { patched } = renderDetail('MANUAL')
  const input = await screen.findByLabelText('Próximo vencimento do acerto')
  expect(input).toHaveValue('2099-12-10')
  await userEvent.clear(input)
  await userEvent.type(input, '2100-01-10')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar vencimento' }))
  await waitFor(() => expect(patched()).toEqual({ manualNextDueDate: '2100-01-10' }))
})

it('an Asaas office has no manual due date to edit', async () => {
  renderDetail('ASAAS')
  expect(await screen.findByText('Asaas')).toBeInTheDocument()
  expect(screen.queryByLabelText('Próximo vencimento do acerto')).not.toBeInTheDocument()
})
