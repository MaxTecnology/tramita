import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('gaveta da tarefa — teclado e leitor de tela', () => {
  it('is a modal dialog named by the task; Escape closes it; focus starts inside', async () => {
    const onClose = vi.fn()
    render(<TaskDrawer task={task} currentUserId="ana" role="ORG_ADMIN" clientId="cl1" onClose={onClose} />, { wrapper })
    const dialog = await screen.findByRole('dialog', { name: 'Registro na Junta' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('the title is renamed from the keyboard too', async () => {
    open(task)
    const rename = await screen.findByRole('button', { name: 'Renomear: Registro na Junta' })
    rename.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Título da tarefa' })).toHaveValue('Registro na Junta')
  })

  it('tabs control their panel and move with the arrow keys', async () => {
    open(task)
    const tabs = await screen.findAllByRole('tab')
    expect(screen.getByRole('tabpanel', { name: 'Comentários' })).toBeInTheDocument()
    expect(tabs[0]).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)
    tabs[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Documentos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Documentos' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Histórico' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('gaveta da tarefa — dados', () => {
  it('a recurring task says why its dates are fixed, in text', async () => {
    open({ ...task, recurringTemplateId: 'rt1' })
    expect(await screen.findAllByText('Definida pela tarefa recorrente')).toHaveLength(2)
  })

  it('a task without department does not pretend to have the first one', async () => {
    open({ ...task, departmentId: null })
    expect(await screen.findByLabelText('Departamento')).toHaveDisplayValue('Escolha o departamento')
  })

  it('a change arriving while the drawer is open shows up (dates and description)', async () => {
    const { rerender } = render(<TaskDrawer task={task} currentUserId="ana" role="ORG_ADMIN" clientId="cl1" onClose={() => {}} />, { wrapper })
    expect(await screen.findByLabelText('Prazo')).toHaveValue('2026-11-30')
    rerender(<TaskDrawer task={{ ...task, dueDate: '2026-12-15T00:00:00.000Z', description: 'Nova orientação' }} currentUserId="ana" role="ORG_ADMIN" clientId="cl1" onClose={() => {}} />)
    expect(screen.getByLabelText('Prazo')).toHaveValue('2026-12-15')
    expect(screen.getByLabelText('Descrição')).toHaveValue('Nova orientação')
  })

  it('a disregarded task is never shown as overdue', async () => {
    open({ ...task, status: 'DISREGARDED', dueDate: '2020-01-01T00:00:00.000Z', viewerCanEdit: false }, 'ORG_MEMBER', 'bruna')
    expect(await screen.findByText('01/01/2020')).toBeInTheDocument()
    expect(screen.queryByText(/vencido/)).not.toBeInTheDocument()
  })
})
