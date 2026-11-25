import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Clients from './Clients'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))
vi.mock('./clients/ClientForm', () => ({ ClientForm: ({ submitLabel }: { submitLabel: string }) => <button type="button">{submitLabel}</button> }))

const client = (id: string, name: string, extra: object = {}) => ({
  id, name, codigo: null, clientType: 'PJ', cnpj: null, cpf: null, cei: null, caepf: null, inscricaoEstadual: null,
  whatsapp: null, phone: null, notes: null, cep: null, estado: 'AL', cidade: 'Maceió', ibgeCityCode: 2704302,
  bairro: null, logradouro: null, numero: null, complemento: null, isActive: true, createdAt: '2026-01-01', ...extra,
})
const CLIENTS = [
  client('c1', 'Padaria Pão Quente', { codigo: '0001', cnpj: '55103303000121', whatsapp: '82999990000' }),
  client('c2', 'João Silva', { codigo: '0002', clientType: 'PF', cpf: '52998224725', estado: 'SE', cidade: 'Aracaju' }),
  client('c3', 'Antiga Ltda', { codigo: '0003', cnpj: '11222333000181', isActive: false }),
]

let calls: string[] = []
beforeEach(() => {
  calls = []
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/clients`, ({ request }) => {
      const inactive = new URL(request.url).searchParams.get('includeInactive') === 'true'
      return HttpResponse.json(inactive ? CLIENTS : CLIENTS.filter((c) => c.isActive))
    }),
    http.get(`${API}/clients/:id/assignments`, () => HttpResponse.json([])),
    http.get(`${API}/clients/:id/users`, () => HttpResponse.json([])),
    http.delete(`${API}/clients/:id`, ({ params }) => { calls.push(`delete ${params.id}`); return HttpResponse.json({}) }),
    http.post(`${API}/clients/:id/reactivate`, ({ params }) => { calls.push(`reactivate ${params.id}`); return HttpResponse.json({}) }),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/clients']}><Clients /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const row = async (name: string) => (await screen.findByText(name)).closest('[data-list-row]') as HTMLElement

describe('Clientes', () => {
  it('standard header; new client opens in the same dialog as editing', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Novo cliente' }))
    expect(await screen.findByRole('dialog', { name: 'Novo cliente' })).toBeInTheDocument()
  })

  it('each row: code and name, formatted document, city/UF and contact', async () => {
    renderPage()
    const padaria = await row('Padaria Pão Quente')
    expect(within(padaria).getByText('0001')).toBeInTheDocument()
    expect(within(padaria).getByText('55.103.303/0001-21')).toBeInTheDocument()
    expect(within(padaria).getByText('Maceió/AL')).toBeInTheDocument()
    const joao = await row('João Silva')
    expect(within(joao).getByText('529.982.247-25')).toBeInTheDocument()
    expect(within(joao).getByText('PF')).toBeInTheDocument()
    expect(within(joao).getByText('Aracaju/SE')).toBeInTheDocument()
  })

  it('the name opens the client to edit', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Padaria Pão Quente' }))
    expect(await screen.findByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
  })

  it('search finds a CNPJ typed with or without punctuation', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Padaria Pão Quente' })
    await userEvent.type(screen.getByLabelText('Buscar clientes'), '55.103.303')
    expect(screen.queryByRole('button', { name: 'João Silva' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Padaria Pão Quente' })).toBeInTheDocument()
  })

  it('deactivating sits in the menu and asks first', async () => {
    renderPage()
    await userEvent.click(within(await row('Padaria Pão Quente')).getByRole('button', { name: 'Mais ações de Padaria Pão Quente' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Desativar' }))
    expect(confirmMock).toHaveBeenCalled()
    await waitFor(() => expect(calls).toEqual(['delete c1']))
  })

  it('a deactivated client is marked and can be reactivated', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mostrar desativados' }))
    const old = await row('Antiga Ltda')
    expect(within(old).getByText('Desativado')).toBeInTheDocument()
    await userEvent.click(within(old).getByRole('button', { name: 'Mais ações de Antiga Ltda' }))
    expect(screen.queryByRole('menuitem', { name: 'Desativar' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reativar' }))
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reativar o cliente "Antiga Ltda"?', description: expect.stringMatching(/portal.*recorrentes/s) }))
    await waitFor(() => expect(calls).toEqual(['reactivate c3']))
  })

  it('a deactivated client opens to edit too (to fix it before reactivating)', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mostrar desativados' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Antiga Ltda' }))
    expect(await screen.findByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument()
  })

  it('numbers inside a name search do not match documents', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Padaria Pão Quente' })
    await userEvent.type(screen.getByLabelText('Buscar clientes'), 'João 0001')
    expect(screen.queryByRole('button', { name: 'Padaria Pão Quente' })).not.toBeInTheDocument()
  })
})
