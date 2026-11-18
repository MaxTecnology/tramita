import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import OSList from './OSList'

const API = 'http://localhost:3000'
let situationAsked: string | null = null
let opened: Record<string, unknown> | null = null
const item = (id: string, title: string, deadline: object, extra: object = {}) => ({
  id, title, status: 'OPEN', competence: null, dueDate: null, targetDate: '2026-11-20T00:00:00.000Z',
  client: { id: 'c1', name: 'ACME', codigo: '320' }, osModel: { id: 'm1', name: 'Recálculo DAS' },
  assignee: { id: 'u1', name: 'Bruna' }, department: { id: 'd1', name: 'Fiscal' }, process: null,
  deadline: { officeBusinessDays: 1, clientBusinessDays: 0, ...deadline }, delayReasonPending: false, link: `/app/tasks?task=${id}`, ...extra,
})

beforeEach(() => {
  situationAsked = null
  opened = null
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role: 'ORG_ADMIN', organizationId: 'o1' }))
  server.use(
    http.get(`${API}/os`, ({ request }) => {
      situationAsked = new URL(request.url).searchParams.get('situation')
      return HttpResponse.json([
        item('t1', 'Recálculo DAS — 03/2025', { state: 'LATE', businessDaysLate: 2 }),
        item('t2', 'Registro na Junta', { state: 'WAITING_DEPENDENCY' }, { process: { id: 'b1', title: 'Abertura ACME' } }),
      ])
    }),
    http.get(`${API}/os-models`, () => HttpResponse.json([
      { id: 'm1', name: 'Recálculo DAS', requiresCompetence: true, usableStandalone: true, isActive: true },
      { id: 'm2', name: 'Certidão', requiresCompetence: false, usableStandalone: true, isActive: true },
      { id: 'm3', name: 'Registro na Junta', requiresCompetence: false, usableStandalone: false, isActive: true },
      { id: 'm4', name: 'Modelo antigo', requiresCompetence: false, usableStandalone: true, isActive: false },
    ])),
    http.get(`${API}/clients`, () => HttpResponse.json([{ id: 'c1', name: 'ACME', codigo: '320' }])),
    http.post(`${API}/os`, async ({ request }) => { opened = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 't9' }, { status: 201 }) }),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/os']}>
        <Routes>
          <Route path="/app/os" element={<OSList />} />
          <Route path="/app/tasks" element={<p>tela de tarefas</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('lists the OS with their deadline situation and process, and opens one', async () => {
  renderPage()
  expect(await screen.findByText('Recálculo DAS — 03/2025')).toBeInTheDocument()
  expect(screen.getByText('atrasada há 2 dias úteis')).toBeInTheDocument()
  expect(screen.getByText('Abertura ACME')).toBeInTheDocument()
  await userEvent.click(screen.getByText('Recálculo DAS — 03/2025'))
  expect(await screen.findByText('tela de tarefas')).toBeInTheDocument()
})

it('filters by situation', async () => {
  renderPage()
  await screen.findByText('Recálculo DAS — 03/2025')
  await userEvent.click(screen.getByRole('radio', { name: 'Atrasadas' }))
  await waitFor(() => expect(situationAsked).toBe('LATE'))
})

it('opens a new OS, asking the month when the model needs it', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Nova OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm1')
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  await userEvent.type(screen.getByLabelText('Competência'), '2025-03')
  await userEvent.click(screen.getByRole('button', { name: 'Abrir OS' }))
  await waitFor(() => expect(opened).toEqual({ osModelId: 'm1', clientId: 'c1', competence: '2025-03' }))
})

it('Nova OS offers only active standalone models (process-only ones stay in the list filter)', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Nova OS' }))
  const options = Array.from((screen.getByLabelText('Modelo de OS') as HTMLSelectElement).options).map((o) => o.textContent)
  expect(options).toEqual(['Selecione', 'Recálculo DAS', 'Certidão'])
  const filter = Array.from((screen.getByLabelText('Filtrar por modelo') as HTMLSelectElement).options).map((o) => o.textContent)
  expect(filter).toContain('Registro na Junta')
})

it('standard list: OS with its process, client, who handles it, deadline with the target date', async () => {
  renderPage()
  expect(screen.getByRole('heading', { name: 'Ordens de Serviço' })).toBeInTheDocument()
  const late = (await screen.findByRole('button', { name: 'Recálculo DAS — 03/2025' })).closest('[data-list-row]') as HTMLElement
  expect(within(late).getByText('ACME')).toBeInTheDocument()
  expect(within(late).getByText('#320')).toBeInTheDocument()
  expect(within(late).getByText('Bruna')).toBeInTheDocument()
  expect(within(late).getByText('Fiscal')).toBeInTheDocument()
  expect(within(late).getByText('atrasada há 2 dias úteis')).toBeInTheDocument()
  expect(within(late).getByText('Meta 20/11/2026')).toBeInTheDocument()
  const junta = screen.getByRole('button', { name: 'Registro na Junta' }).closest('[data-list-row]') as HTMLElement
  expect(within(junta).getByText('Abertura ACME')).toBeInTheDocument()
  expect(screen.getByLabelText('Buscar ordens de serviço')).toBeInTheDocument()
})
