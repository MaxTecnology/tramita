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
