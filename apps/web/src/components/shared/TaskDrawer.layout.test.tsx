import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

const task: Task = {
  id: 't1', title: 'Registro na Junta', description: null, priority: 'MEDIUM', status: 'OPEN', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'ana', dueDate: '2026-11-30T00:00:00.000Z', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  sourceRequestId: 'r1', departmentId: 'fiscal', competence: null, targetDate: '2026-11-25T00:00:00.000Z', recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: true,
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

beforeEach(() => {
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'ana', role: 'ORG_ADMIN', departments: [{ id: 'fiscal', name: 'Fiscal' }], seesDepartmentWork: true })),
    http.get(`${API}/users/options`, () => HttpResponse.json([{ id: 'ana', name: 'Ana', departmentIds: ['fiscal'] }])),
    http.get(`${API}/clients/cl1/assignments`, () => HttpResponse.json([{ department: { id: 'fiscal', name: 'Fiscal' } }])),
    http.get(`${API}/tasks/t1/comments`, () => HttpResponse.json([])),
    http.get(`${API}/requests/r1/comments`, () => HttpResponse.json([])),
  )
})

const open = (t: Task, role: 'ORG_ADMIN' | 'ORG_MEMBER' = 'ORG_ADMIN', me = 'ana') =>
  render(<TaskDrawer task={t} currentUserId={me} role={role} clientId="cl1" onClose={() => {}} />, { wrapper })

describe('gaveta da tarefa', () => {
  it('every field of the task has a visible name', async () => {
    open(task)
    expect(await screen.findByLabelText('Status')).toHaveDisplayValue('Aberto')
    expect(screen.getByLabelText('Prioridade')).toHaveDisplayValue('Média')
    expect(await screen.findByLabelText('Departamento')).toHaveDisplayValue('Fiscal')
    expect(await screen.findByLabelText('Responsável')).toHaveDisplayValue('Ana')
    expect(screen.getByLabelText('Prazo')).toHaveValue('2026-11-30')
    expect(screen.getByLabelText('Meta')).toHaveValue('2026-11-25')
    expect(screen.getByLabelText('Cliente pode ver')).toBeChecked()
  })

  it('read-only, the same names show the values as text', async () => {
    open({ ...task, viewerCanEdit: false }, 'ORG_MEMBER', 'bruna')
    const fields = await screen.findByRole('list', { name: 'Dados da tarefa' })
    expect(within(fields).getByText('Prioridade')).toBeInTheDocument()
    expect(within(fields).getByText('Média')).toBeInTheDocument()
    expect(within(fields).getByText('Prazo')).toBeInTheDocument()
    expect(within(fields).getByText('30/11/2026')).toBeInTheDocument()
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('closing is a named button', async () => {
    open(task)
    expect(await screen.findByRole('button', { name: 'Fechar' })).toBeInTheDocument()
  })

  it('all tabs sit in one tab list, the open one marked', async () => {
    open(task)
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Comentários', 'Documentos', 'Anexos', 'Protocolos', 'Histórico'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('the conversation of the source request is its own section, closed, apart from the task comments', async () => {
    open(task)
    expect(await screen.findByRole('heading', { name: 'Comentários da tarefa' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /Conversa da solicitação de origem/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
