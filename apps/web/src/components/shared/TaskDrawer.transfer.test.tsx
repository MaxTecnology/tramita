import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

const task: Task = {
  id: 't1', title: 'Folha de pagamento', description: null, priority: 'MEDIUM', status: 'BLOCKED', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'ingrite', dueDate: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  sourceRequestId: null, departmentId: 'pessoal', competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: true,
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

const patched = vi.fn()

beforeEach(() => {
  patched.mockReset()
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'ingrite', role: 'ORG_MANAGER', departments: [{ id: 'pessoal', name: 'Pessoal' }], seesDepartmentWork: true })),
    http.get(`${API}/users/options`, () => HttpResponse.json([
      { id: 'ingrite', name: 'Ingrite', departmentIds: ['pessoal'] },
      { id: 'bruna', name: 'Bruna', departmentIds: ['pessoal', 'fiscal'] },
      { id: 'carla', name: 'Carla', departmentIds: ['fiscal'] },
    ])),
    http.get(`${API}/tasks/t1/comments`, () => HttpResponse.json([])),
    http.get(`${API}/tasks/t1/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/departments/served`, () => HttpResponse.json([])),
    http.get(`${API}/tasks/t1/history`, () => HttpResponse.json([
      { id: 'h1', taskId: 't1', action: 'status_changed', fromValue: 'OPEN', toValue: 'BLOCKED', actorType: 'system', actorId: 'system', actorName: 'Sistema (recorrência)', createdAt: new Date().toISOString() },
      { id: 'h2', taskId: 't1', action: 'assigned_to', fromValue: 'ingrite', toValue: 'bruna', actorType: 'user', actorId: 'ingrite', actorName: 'Ingrite', createdAt: new Date().toISOString() },
    ])),
    http.patch(`${API}/tasks/t1`, async ({ request }) => { patched(await request.json()); return HttpResponse.json({ ...task, assigneeId: 'bruna' }) }),
  )
})

it('the owner passes the task to a colleague of the same department', async () => {
  render(<TaskDrawer task={task} currentUserId="ingrite" role="ORG_MANAGER" onClose={() => {}} />, { wrapper })
  const select = await screen.findByLabelText('Responsável')
  await waitFor(() => expect(screen.getByRole('option', { name: 'Bruna' })).toBeInTheDocument())
  expect(screen.queryByRole('option', { name: 'Carla' })).not.toBeInTheDocument() // not in Pessoal
  fireEvent.change(select, { target: { value: 'bruna' } })
  await waitFor(() => expect(patched).toHaveBeenCalledWith({ assigneeId: 'bruna' }))
})

it('the history speaks the user language: status label and people names', async () => {
  render(<TaskDrawer task={task} currentUserId="ingrite" role="ORG_MANAGER" onClose={() => {}} />, { wrapper })
  fireEvent.click(await screen.findByRole('tab', { name: /Histórico/ }))
  expect(await screen.findByText(/alterou status para Com Impedimento/)).toBeInTheDocument()
  expect(await screen.findByText(/alterou responsável para Bruna/)).toBeInTheDocument()
})
