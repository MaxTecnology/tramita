import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const now = new Date().toISOString()
const base: Task = {
  id: 't1', title: 'Recálculo DAS — 03/2025', description: null, priority: 'MEDIUM', status: 'OPEN', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'bruna', dueDate: null, createdAt: now, updatedAt: now,
  sourceRequestId: null, departmentId: 'fiscal', competence: null, targetDate: '2026-01-07T00:00:00.000Z', recurringTemplateId: null,
  visibleToClient: true, viewerCanEdit: true,
  osModelId: 'm1', osModel: { id: 'm1', name: 'Recálculo DAS' }, releasedAt: '2026-01-02T12:00:00.000Z',
  deadline: { state: 'LATE', businessDaysLate: 4, officeBusinessDays: 7, clientBusinessDays: 2 },
}
const patched = vi.fn()
const released = vi.fn()

function setup(role: 'ORG_MANAGER' | 'ORG_MEMBER') {
  patched.mockReset()
  released.mockReset()
  let calls = 0
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role, departments: [{ id: 'fiscal', name: 'Fiscal' }], seesDepartmentWork: true })),
    http.get(`${API}/users/options`, () => HttpResponse.json([{ id: 'bruna', name: 'Bruna', departmentIds: ['fiscal'] }])),
    http.get(`${API}/tasks/t1/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/delay-reasons`, () => HttpResponse.json([{ id: 'r2', name: 'Retrabalho interno', requiresNote: false, isActive: true, position: 0 }])),
    http.patch(`${API}/tasks/t1`, async ({ request }) => {
      const body = await request.json()
      patched(body)
      calls++
      return calls === 1
        ? HttpResponse.json({ message: 'Informe o motivo do atraso' }, { status: 422 })
        : HttpResponse.json({ ...base, status: 'DONE' })
    }),
    http.post(`${API}/tasks/t1/release`, async ({ request }) => { released(await request.json()); return HttpResponse.json({ id: 't1' }) }),
  )
}

function renderDrawer(task: Task, role: 'ORG_MANAGER' | 'ORG_MEMBER' = 'ORG_MANAGER') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDrawer task={task} currentUserId="bruna" role={role} onClose={() => {}} />
      <AppDialogs />
    </QueryClientProvider>,
  )
}

beforeEach(() => setup('ORG_MANAGER'))

it('shows the OS deadline: late, office days and days waiting for the client', async () => {
  renderDrawer(base)
  expect(await screen.findByText('atrasada há 4 dias úteis')).toBeInTheDocument()
  expect(screen.getByText(/7 dias úteis do escritório · 2 aguardando o cliente/)).toBeInTheDocument()
})

it('finishing a late OS asks the reason and sends it', async () => {
  renderDrawer(base)
  await userEvent.selectOptions(await screen.findByDisplayValue('Aberto'), 'DONE')
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r2')
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(patched).toHaveBeenLastCalledWith({ status: 'DONE', delayReasonId: 'r2' }))
})

it('an OS waiting for another one says so; the manager can release it with a reason', async () => {
  renderDrawer({ ...base, releasedAt: null, deadline: { state: 'WAITING_DEPENDENCY', officeBusinessDays: 0, clientBusinessDays: 0 }, waitingFor: ['Registro na Junta'] })
  expect(await screen.findByText('aguardando Registro na Junta')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('Aberto')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Liberar agora' }))
  await userEvent.type(await screen.findByLabelText('Por que liberar antes?'), 'Junta já registrou')
  await userEvent.click(screen.getByRole('button', { name: 'Liberar' }))
  await waitFor(() => expect(released).toHaveBeenCalledWith({ reason: 'Junta já registrou' }))
})

it('a member does not release early', async () => {
  setup('ORG_MEMBER')
  renderDrawer({ ...base, releasedAt: null, deadline: { state: 'WAITING_DEPENDENCY', officeBusinessDays: 0, clientBusinessDays: 0 }, waitingFor: ['Registro na Junta'] }, 'ORG_MEMBER')
  expect(await screen.findByText('aguardando Registro na Junta')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Liberar agora' })).not.toBeInTheDocument()
})
