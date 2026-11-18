import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import RecurringTemplates from './RecurringTemplates'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

const base = { departmentId: 'd1', department: { id: 'd1', name: 'Fiscal' }, priority: 'MEDIUM', dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1, isActive: true, documentRequests: [], documentDeliveries: [], onlyListedLocations: false }
const TEMPLATES = [
  { ...base, id: 't1', title: 'ICMS', periodicity: 'MONTHLY', dueDayOfPeriod: 20, dueScope: 'STATE', dueRules: [{}, {}], assignmentsCount: 12 },
  { ...base, id: 't2', title: 'Folha de pagamento', periodicity: 'MONTHLY', dueDayOfPeriod: 5, dueScope: 'FEDERAL', dueRules: [], assignmentsCount: 40, department: { id: 'd2', name: 'Pessoal' } },
  { ...base, id: 't3', title: 'DIRF antiga', periodicity: 'ANNUAL', dueDayOfPeriod: 28, dueScope: 'FEDERAL', dueRules: [], assignmentsCount: 0, isActive: false },
]

let deleted: string | null = null
function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/recurring-templates']}>
        <Routes>
          <Route path="/app/settings/recurring-templates" element={<RecurringTemplates />} />
          <Route path="/app/settings/recurring-templates/:id/manage" element={<p>tela de vínculos</p>} />
          <Route path="/app/settings/recurring-templates/:id/edit" element={<p>tela de edição</p>} />
          <Route path="/app/settings/recurring-templates/new" element={<p>nova recorrente</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  deleted = null
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/recurring-templates`, () => HttpResponse.json(TEMPLATES)),
    http.get(`${API}/recurring-templates/failed-generations`, () => HttpResponse.json([{ templateId: 't1' }, { templateId: 't1' }, { templateId: 't9' }])),
    http.delete(`${API}/recurring-templates/:id`, ({ params }) => { deleted = String(params.id); return HttpResponse.json({}) }),
  )
})

const row = async (title: string) => (await screen.findByText(title)).closest('[data-list-row]') as HTMLElement

describe('lista de tarefas recorrentes', () => {
  it('shows calendar, department, scope, linked clients and failures of each template', async () => {
    renderPage()
    const icms = await row('ICMS')
    expect(within(icms).getByText('Mensal, vence dia 20')).toBeInTheDocument()
    expect(within(icms).getByText('Fiscal')).toBeInTheDocument()
    expect(within(icms).getByText('Estadual (2 exceções)')).toBeInTheDocument()
    expect(within(icms).getByText('12 clientes')).toBeInTheDocument()
    expect(within(icms).getByText('2 falhas')).toBeInTheDocument()
    const folha = await row('Folha de pagamento')
    expect(within(folha).getByText('Federal')).toBeInTheDocument()
    expect(within(folha).queryByText(/falha/)).not.toBeInTheDocument()
    expect(within(await row('DIRF antiga')).getByText('Inativa')).toBeInTheDocument()
  })

  it('links and generation is a named button; edit and delete live in the menu', async () => {
    renderPage()
    await userEvent.click(within(await row('ICMS')).getByRole('link', { name: 'Vínculos e geração' }))
    expect(await screen.findByText('tela de vínculos')).toBeInTheDocument()
  })

  it('deleting asks first', async () => {
    renderPage()
    await userEvent.click(within(await row('Folha de pagamento')).getByRole('button', { name: 'Mais ações de Folha de pagamento' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Editar', 'Excluir'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    await waitFor(() => expect(deleted).toBe('t2'))
    expect(confirmMock).toHaveBeenCalled()
  })

  it('filters by name', async () => {
    renderPage()
    await screen.findByText('ICMS')
    await userEvent.type(screen.getByLabelText('Buscar tarefas recorrentes'), 'folha')
    expect(screen.queryByText('ICMS')).not.toBeInTheDocument()
    expect(screen.getByText('Folha de pagamento')).toBeInTheDocument()
  })
})
