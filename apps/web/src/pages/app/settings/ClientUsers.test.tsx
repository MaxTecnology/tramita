import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import ClientUsers from './ClientUsers'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

const access = (clientId: string, client: string, department: string) => ({ client: { id: clientId, name: client }, department: { id: department, name: department } })
let deleted: string | null = null
beforeEach(() => {
  deleted = null
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/client-users`, () => HttpResponse.json([
      { id: 'c1', name: 'Carlos Lima', email: 'carlos@acme.com', phone: null, isActive: true, accesses: [access('k1', 'ACME', 'Fiscal'), access('k1', 'ACME', 'Pessoal'), access('k2', 'Padaria Boa', 'Fiscal')] },
      { id: 'c2', name: 'Diana Rocha', email: 'diana@x.com', phone: null, isActive: false, accesses: [access('k3', 'Mercado Sul', 'Fiscal')] },
    ])),
    http.delete(`${API}/client-users/:id`, ({ params }) => { deleted = String(params.id); return HttpResponse.json({}) }),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ClientUsers /></MemoryRouter></QueryClientProvider>)
})

const row = async (name: string) => (await screen.findByText(name)).closest('[data-list-row]') as HTMLElement

it('groups the accesses by company, with the departments of each', async () => {
  const carlos = await row('Carlos Lima')
  expect(within(carlos).getByText('ACME')).toBeInTheDocument()
  expect(within(carlos).getByText('Fiscal, Pessoal')).toBeInTheDocument()
  expect(within(carlos).getByText('Padaria Boa')).toBeInTheDocument()
  expect(within(await row('Diana Rocha')).getByText('Inativo')).toBeInTheDocument()
})

it('searches by person or company', async () => {
  await screen.findByText('Carlos Lima')
  await userEvent.type(screen.getByLabelText('Buscar acessos'), 'mercado')
  expect(screen.queryByText('Carlos Lima')).not.toBeInTheDocument()
  expect(screen.getByText('Diana Rocha')).toBeInTheDocument()
})

it('deactivating is in the menu and asks first; an inactive contact has nothing to deactivate', async () => {
  await userEvent.click(within(await row('Carlos Lima')).getByRole('button', { name: 'Mais ações de Carlos Lima' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Desativar' }))
  await waitFor(() => expect(deleted).toBe('c1'))
  expect(within(await row('Diana Rocha')).queryByRole('button', { name: /Mais ações/ })).not.toBeInTheDocument()
})
