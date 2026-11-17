import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import RecurringTemplateManage from './RecurringTemplateManage'

const API = 'http://localhost:3000'

const template = (onlyListedLocations: boolean) => ({
  id: 't1', title: 'ICMS', departmentId: 'dp', department: { id: 'dp', name: 'Fiscal' }, periodicity: 'MONTHLY', priority: 'MEDIUM',
  dueDayOfPeriod: 20, dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1, competenceMonthOffset: 1, targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
  generationMonthOffset: 1, generationDayOfPeriod: 1, autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
  dueScope: 'STATE', onlyListedLocations,
  dueRules: [{ id: 'r1', uf: 'SE', ibgeCityCode: null, dueDayOfPeriod: 15, dueBusinessDayRoll: 'NONE', municipality: null }],
})

const assignments = [
  { id: 'a1', templateId: 't1', clientId: 'c1', isActive: true, client: { id: 'c1', name: 'Padaria', codigo: '1', estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308 } },
  { id: 'a2', templateId: 't1', clientId: 'c2', isActive: true, client: { id: 'c2', name: 'Mercado', codigo: '2', estado: 'AL', cidade: 'Maceió', ibgeCityCode: 2704302 } },
]

const clients = [
  { id: 'c3', name: 'Oficina', codigo: '3', estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308, servedDepartmentIds: ['dp'] },
  { id: 'c4', name: 'Farmácia', codigo: '4', estado: 'BA', cidade: 'Salvador', ibgeCityCode: 2927408, servedDepartmentIds: ['dp'] },
]

function renderManage(onlyListed: boolean) {
  server.use(
    http.get(`${API}/recurring-templates/t1`, () => HttpResponse.json(template(onlyListed))),
    http.get(`${API}/recurring-templates/t1/assignments`, () => HttpResponse.json(assignments)),
    http.get(`${API}/recurring-templates/t1/generation-log`, () => HttpResponse.json([])),
    http.get(`${API}/recurring-templates/failed-generations`, () => HttpResponse.json([])),
    http.get(`${API}/clients`, () => HttpResponse.json(clients)),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/recurring-templates/t1/manage']}>
        <Routes>
          <Route path="/app/settings/recurring-templates/:id/manage" element={<RecurringTemplateManage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => server.resetHandlers())

describe('vínculos de recorrência com vencimento por localidade', () => {
  it('each linked client shows its state and city', async () => {
    renderManage(false)
    expect(await screen.findByText('Aracaju (SE)')).toBeInTheDocument()
    expect(screen.getByText('Maceió (AL)')).toBeInTheDocument()
  })

  it('with "only listed places", select all picks only the clients inside them', async () => {
    renderManage(true)
    await screen.findByText('Aracaju (SE)')
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    expect(screen.getByRole('button', { name: /Gerar selecionados \(1\)/ })).toBeInTheDocument()
    expect(screen.getByText('Fora dos locais')).toBeInTheDocument()
  })

  it('without it, select all picks everyone', async () => {
    renderManage(false)
    await screen.findByText('Aracaju (SE)')
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }))
    expect(screen.getByRole('button', { name: /Gerar selecionados \(2\)/ })).toBeInTheDocument()
  })

  it('linking a client outside the listed places warns, without blocking', async () => {
    renderManage(true)
    const picker = await screen.findByRole('combobox', { name: 'Cliente a vincular' })
    await waitFor(() => expect(within(picker).getByRole('option', { name: /Farmácia — fora dos locais da recorrência/ })).toBeInTheDocument())
    await userEvent.selectOptions(picker, 'c4')
    expect(screen.getByText('Este cliente está fora dos locais da recorrência: a tarefa dele não será gerada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vincular cliente' })).toBeEnabled()
  })
})
