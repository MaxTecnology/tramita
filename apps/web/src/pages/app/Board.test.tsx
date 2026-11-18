import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Board from './Board'

const API = 'http://localhost:3000'
vi.mock('@/hooks/useBoardStream', () => ({ useBoardStream: () => undefined }))

const task = (id: string, title: string, priority: string) => ({
  id, title, priority, status: 'OPEN', description: null, position: 0, columnId: 'k0', tags: [], creatorId: 'u1', assigneeId: null,
  dueDate: null, createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z', sourceRequestId: null, departmentId: 'd1',
  competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
})

beforeEach(() => {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role: 'ORG_ADMIN', organizationId: 'o1' }))
  server.use(
    http.get(`${API}/boards/b1`, () => HttpResponse.json({
      id: 'b1', title: 'Abertura ACME', type: 'PROCESS', clientId: 'cl1', client: { id: 'cl1', name: 'ACME' }, dueDate: null,
      deadline: { state: 'ON_TIME', businessDaysLeft: 8, officeBusinessDays: 2, clientBusinessDays: 0 },
      columns: [
        { id: 'k0', title: 'A fazer', position: 0, tasks: [task('t1', 'Registro na Junta', 'MEDIUM'), task('t2', 'Alvará', 'HIGH')] },
        { id: 'k1', title: 'Concluído', position: 1, tasks: [] },
      ],
    })),
    http.get(`${API}/boards/b1/tasks/search`, () => HttpResponse.json([task('t1', 'Registro na Junta', 'MEDIUM')])),
    http.get(`${API}/clients/cl1/assignments`, () => HttpResponse.json([{ department: { id: 'd1', name: 'Fiscal' } }])),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/board/b1']}>
        <Routes>
          <Route path="/app/board/:boardId" element={<Board />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('quadro do processo', () => {
  it('header: way back, process and client, and its actions as buttons', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Abertura ACME' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Processos/ })).toHaveAttribute('href', '/app/processes')
    expect(screen.getByRole('button', { name: 'Tempo por etapa' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Adicionar OS' })).toBeInTheDocument()
  })

  it('cards show priority only when it matters', async () => {
    renderPage()
    const todo = await screen.findByRole('region', { name: 'A fazer' })
    await within(todo).findByText('Registro na Junta')
    expect(within(todo).getByText('Alta')).toBeInTheDocument()
    expect(within(todo).queryByText('Média')).not.toBeInTheDocument()
  })

  it('search results say the priority in words and open the task', async () => {
    renderPage()
    await userEvent.type(await screen.findByLabelText('Buscar tarefas do processo'), 'Junta')
    const result = await within(await screen.findByRole('region', { name: 'Resultados da busca' })).findByRole('button', { name: /Registro na Junta/ })
    expect(result).toHaveTextContent('Média')
    expect(screen.queryByText('MEDIUM')).not.toBeInTheDocument()
  })
})
