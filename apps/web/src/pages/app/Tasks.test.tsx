import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Tasks from './Tasks'

const API = 'http://localhost:3000'

vi.mock('@/hooks/useBoardStream', () => ({ useBoardStream: () => undefined }))
vi.mock('@/components/shared/TaskDrawer', async (orig) => ({
  ...(await orig<typeof import('@/components/shared/TaskDrawer')>()),
  TaskDrawer: ({ task }: { task: { title: string } }): ReactNode => <div role="dialog" aria-label={`Tarefa ${task.title}`} />,
}))

const board = (type: 'PROCESS' | 'SERVICE_SYSTEM' | 'RECURRING_SYSTEM', title?: string) => ({
  id: `b-${type}`, clientId: 'c1', type, title, client: { id: 'c1', name: 'Padaria Pão Quente', codigo: '0001' },
})
const base = {
  description: null, position: 0, columnId: 'col', creatorId: 'u1', sourceRequestId: null, tags: [], competence: null,
  recurringTemplateId: null, visibleToClient: true, createdAt: '2026-11-01', updatedAt: '2026-11-01', dueDate: null,
}
const TASKS = [
  {
    ...base, id: 't1', title: 'Registro na Junta', status: 'BLOCKED', priority: 'MEDIUM', targetDate: '2026-11-25T00:00:00.000Z',
    assigneeId: 'u1', departmentId: 'd1', department: { id: 'd1', name: 'Legalização' }, assignee: { id: 'u1', name: 'Ana Souza' },
    column: { board: board('PROCESS', '0001 - Padaria Pão Quente — Abertura de empresa com um nome bem comprido') },
    osModel: { id: 'm1', name: 'Registro na Junta' }, deadline: { state: 'DUE_SOON', businessDaysLeft: 3 },
  },
  {
    ...base, id: 't2', title: 'DAS do Simples', status: 'OPEN', priority: 'URGENT', targetDate: '2026-11-20T00:00:00.000Z',
    assigneeId: null, departmentId: 'd2', department: { id: 'd2', name: 'Fiscal' }, assignee: null,
    column: { board: board('RECURRING_SYSTEM') }, osModel: null,
  },
]

let lastQuery: URLSearchParams | null = null
function renderPage() {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Ana Souza', role: 'ORG_ADMIN', organizationId: 'o1' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/tasks']}><Tasks /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  lastQuery = null
  localStorage.clear()
  server.use(
    http.get(`${API}/tasks`, ({ request }) => { lastQuery = new URL(request.url).searchParams; return HttpResponse.json({ items: TASKS, nextCursor: null }) }),
    http.get(`${API}/clients`, () => HttpResponse.json([{ id: 'c1', name: 'Padaria Pão Quente', codigo: '0001' }])),
    http.get(`${API}/users/options`, () => HttpResponse.json([{ id: 'u1', name: 'Ana Souza', departmentIds: ['d1'] }])),
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'u1', role: 'ORG_ADMIN', departments: [{ id: 'd1', name: 'Legalização' }], seesDepartmentWork: true })),
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'd1', name: 'Legalização' }, { id: 'd2', name: 'Fiscal' }])),
    http.get(`${API}/recurring-templates`, () => HttpResponse.json([])),
  )
})

const row = async (title: string) => (await screen.findByRole('button', { name: title })).closest('[data-list-row]') as HTMLElement

describe('Tarefas — lista', () => {
  it('has the standard header and says which view is on', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Tarefas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('each row: task with its OS and process, client, who and which department, status and deadline', async () => {
    renderPage()
    const r = await row('Registro na Junta')
    expect(within(r).getByText('Padaria Pão Quente')).toBeInTheDocument()
    expect(within(r).getByText('#0001')).toBeInTheDocument()
    expect(within(r).getByText('Ana Souza')).toBeInTheDocument()
    expect(within(r).getByText('Legalização')).toBeInTheDocument()
    expect(within(r).getByText('Com Impedimento')).toBeInTheDocument()
    expect(within(r).getByText('faltam 3 dias úteis')).toBeInTheDocument()
    expect(within(r).getByText(/Abertura de empresa/)).toBeInTheDocument()
    const das = await row('DAS do Simples')
    expect(within(das).getByText('Sem responsável')).toBeInTheDocument()
    expect(within(das).getByText('20/11/2026')).toBeInTheDocument()
  })

  it('priority only shows when it matters (Alta, Urgente)', async () => {
    renderPage()
    expect(within(await row('DAS do Simples')).getByText('Urgente')).toBeInTheDocument()
    expect(within(await row('Registro na Junta')).queryByText('Média')).not.toBeInTheDocument()
  })

  it('the task title opens it', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Registro na Junta' }))
    expect(await screen.findByRole('dialog', { name: 'Tarefa Registro na Junta' })).toBeInTheDocument()
  })
})

describe('Tarefas — filtros', () => {
  it('client, colleague, department and type stay behind "Filtros"; a chosen one shows and can be removed', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Registro na Junta' })
    expect(screen.queryByLabelText('Cliente')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Filtros' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
    await waitFor(() => expect(lastQuery?.get('clientId')).toBe('c1'))
    expect(screen.getByRole('button', { name: 'Filtros (1)' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filtros (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tirar filtro Cliente: 0001 - Padaria Pão Quente' }))
    await waitFor(() => expect(lastQuery?.get('clientId')).toBeNull())
  })

  it('search, status and period stay in sight', async () => {
    renderPage()
    expect(screen.getByLabelText('Buscar tarefas')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Período' })).toBeInTheDocument()
  })
})

describe('Tarefas — Kanban', () => {
  it('cards keep long process names inside, and show priority only when it matters', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Kanban' }))
    const card = (await screen.findByText('Registro na Junta', { selector: '[data-task-card] *' })).closest('[data-task-card]') as HTMLElement
    const processName = within(card).getByText(/Abertura de empresa com um nome bem comprido/)
    expect(processName).toHaveClass('truncate')
    expect(processName).toHaveAttribute('title', '0001 - Padaria Pão Quente — Abertura de empresa com um nome bem comprido')
    expect(within(card).queryByText('Média')).not.toBeInTheDocument()
  })
})

describe('Tarefas — trocando filtro', () => {
  it('while the new rows load, the old ones show as loading and cannot be opened', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Registro na Junta' })
    server.use(http.get(`${API}/tasks`, async () => { await delay(300); return HttpResponse.json({ items: [TASKS[1]], nextCursor: null }) }))
    await userEvent.type(screen.getByLabelText('Buscar tarefas'), 'DAS')
    const list = await screen.findByTestId('task-results')
    await waitFor(() => expect(list).toHaveAttribute('aria-busy', 'true'))
    expect(list).toHaveAttribute('inert')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Registro na Junta' })).not.toBeInTheDocument())
    expect(list).toHaveAttribute('aria-busy', 'false')
  })

  it('in the list the full process name shows (no cut)', async () => {
    renderPage()
    const r = await row('Registro na Junta')
    expect(within(r).getByText(/Abertura de empresa com um nome bem comprido/)).not.toHaveClass('truncate')
  })
})
