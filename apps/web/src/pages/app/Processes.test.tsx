import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import Processes from './Processes'

const API = 'http://localhost:3000'

const cols = (tasks: { status: string; col: number }[]) => [
  { id: 'k0', title: 'A fazer', position: 0, tasks: tasks.filter((t) => t.col === 0).map((t, i) => ({ id: `a${i}`, columnId: 'k0', status: t.status, dueDate: null })) },
  { id: 'k1', title: 'Em andamento', position: 1, tasks: tasks.filter((t) => t.col === 1).map((t, i) => ({ id: `b${i}`, columnId: 'k1', status: t.status, dueDate: null })) },
  { id: 'k2', title: 'Concluído', position: 2, tasks: tasks.filter((t) => t.col === 2).map((t, i) => ({ id: `c${i}`, columnId: 'k2', status: t.status, dueDate: null })) },
]
const BOARDS = [
  {
    id: 'p1', title: 'Abertura ACME', dueDate: null, client: { id: 'c1', name: 'ACME' }, responsibleUser: { id: 'u1', name: 'Bruna' },
    deadline: { state: 'ON_TIME', businessDaysLeft: 8, officeBusinessDays: 2, clientBusinessDays: 0 },
    // one OS finished in the panel but still sitting in "A fazer": it counts as done
    columns: cols([{ status: 'DONE', col: 0 }, { status: 'OPEN', col: 0 }, { status: 'STARTED', col: 1 }]),
  },
  {
    id: 'p2', title: 'Alteração contratual BETA', dueDate: null, client: { id: 'c2', name: 'BETA' }, responsibleUser: null,
    deadline: { state: 'DONE', officeBusinessDays: 5, clientBusinessDays: 0 },
    columns: cols([{ status: 'DONE', col: 0 }, { status: 'DONE', col: 2 }]),
  },
]

function renderPage() {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role: 'ORG_ADMIN', organizationId: 'o1' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/processes']}>
        <Routes>
          <Route path="/app/processes" element={<Processes />} />
          <Route path="/app/board/:id" element={<p>quadro do processo</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  server.use(http.get(`${API}/boards`, () => HttpResponse.json(BOARDS)))
})

const row = async (name: string) => (await screen.findByRole('link', { name })).closest('[data-list-row]') as HTMLElement

describe('Processos', () => {
  it('standard header and filters with names', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Processos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Novo processo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar processos')).toBeInTheDocument()
    expect(screen.getByLabelText('Filtrar por cliente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Só atrasados' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('progress counts finished OS by their status, not by the column they sit in', async () => {
    renderPage()
    const r = await row('Abertura ACME')
    expect(within(r).getByText('1 de 3 OS concluídas')).toBeInTheDocument()
    expect(within(r).getByText('ACME')).toBeInTheDocument()
    expect(within(r).getByText('Bruna')).toBeInTheDocument()
    expect(within(r).getByText('faltam 8 dias úteis')).toBeInTheDocument()
  })

  it('a process whose OS are all finished is in Concluídos (closed by default), whatever the columns', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Abertura ACME' })
    const done = screen.getByRole('button', { name: /Concluídos/ })
    expect(done).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Alteração contratual BETA' })).not.toBeInTheDocument()
    await userEvent.click(done)
    expect(await screen.findByRole('link', { name: 'Alteração contratual BETA' })).toBeInTheDocument()
  })

  it('the process name opens its board', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('link', { name: 'Abertura ACME' }))
    expect(await screen.findByText('quadro do processo')).toBeInTheDocument()
  })
})

describe('Processos — regras de prazo e etapa', () => {
  const extra = [
    {
      id: 'p3', title: 'Encerramento GAMA', dueDate: '2020-01-10T00:00:00.000Z', client: { id: 'c3', name: 'GAMA' }, responsibleUser: null,
      deadline: { state: 'NONE', officeBusinessDays: 0, clientBusinessDays: 0 },
      columns: cols([{ status: 'OPEN', col: 1 }]),
    },
    {
      id: 'p4', title: 'Baixa DELTA', dueDate: '2020-01-10T00:00:00.000Z', client: { id: 'c4', name: 'DELTA' }, responsibleUser: null,
      deadline: { state: 'DONE', officeBusinessDays: 3, clientBusinessDays: 0 },
      columns: cols([{ status: 'DONE', col: 2 }]),
    },
    {
      id: 'p5', title: 'Cancelado EPSILON', dueDate: null, client: { id: 'c5', name: 'EPSILON' }, responsibleUser: null,
      deadline: { state: 'NONE', officeBusinessDays: 0, clientBusinessDays: 0 },
      columns: cols([{ status: 'DISREGARDED', col: 0 }]),
    },
  ]
  beforeEach(() => { server.use(http.get(`${API}/boards`, () => HttpResponse.json([...BOARDS, ...extra]))) })

  it('a process past its own due date is in Atrasados, as its row says', async () => {
    renderPage()
    const late = (await screen.findByRole('button', { name: /Atrasados/ })).closest('section') as HTMLElement
    expect(await within(late).findByRole('link', { name: 'Encerramento GAMA' })).toBeInTheDocument()
    expect(within(late).getByText(/Vencido há/)).toBeInTheDocument()
  })

  it('a finished process shows no due date warning', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Concluídos/ }))
    const r = await row('Baixa DELTA')
    expect(within(r).queryByText(/Vencido/)).not.toBeInTheDocument()
  })

  it('a process with every OS dispensed says so and has no stage', async () => {
    renderPage()
    const r = await row('Cancelado EPSILON')
    expect(within(r).getByText('Sem OS ativas')).toBeInTheDocument()
    expect(within(r).queryByText('Concluído')).not.toBeInTheDocument()
  })

  it('the stage filter keeps only processes currently in that stage', async () => {
    renderPage()
    await screen.findByRole('link', { name: 'Abertura ACME' })
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por etapa'), 'Em andamento')
    expect(await screen.findByRole('link', { name: 'Encerramento GAMA' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abertura ACME' })).not.toBeInTheDocument()
  })
})

describe('Processos — com filtro', () => {
  it('"Só atrasados" does not count finished ones, and late ones come first in the results', async () => {
    server.use(http.get(`${API}/boards`, () => HttpResponse.json([
      ...BOARDS,
      { id: 'p6', title: 'Atrasado pelo prazo interno', dueDate: null, client: { id: 'c6', name: 'ZETA' }, responsibleUser: null,
        deadline: { state: 'LATE', businessDaysLate: 2, officeBusinessDays: 9, clientBusinessDays: 0 }, columns: cols([{ status: 'OPEN', col: 0 }]) },
    ])))
    renderPage()
    await screen.findByRole('link', { name: 'Abertura ACME' })
    await userEvent.type(screen.getByLabelText('Buscar processos'), 'a')
    const links = (await screen.findAllByRole('link')).map((l) => l.textContent)
    expect(links[0]).toBe('Atrasado pelo prazo interno')
    await userEvent.click(screen.getByRole('button', { name: 'Só atrasados' }))
    expect(screen.queryByText(/concluídos?$/)).not.toBeInTheDocument()
  })
})
