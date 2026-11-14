import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { api } from '@/lib/api'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const now = new Date().toISOString()
const task: Task = {
  id: 't1', title: 'Folha de pagamento', description: null, priority: 'MEDIUM', status: 'STARTED', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'bruna', dueDate: null, createdAt: now, updatedAt: now,
  sourceRequestId: null, departmentId: 'pessoal', competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: true,
}
const patched = vi.fn()

function renderDrawer() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />
      <AppDialogs />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  patched.mockReset()
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role: 'ORG_MEMBER', departments: [{ id: 'pessoal', name: 'Pessoal' }], seesDepartmentWork: true })),
    http.get(`${API}/tasks/t1/documents`, () => HttpResponse.json({ requirements: [], deliverables: [{ id: 'd1', name: 'Holerites', deliveredAt: null, requiresPayment: false, amount: null, paymentDueDate: null, signedUrl: null }] })),
    http.get(`${API}/tasks/t1/approvals`, () => HttpResponse.json([])),
    http.patch(`${API}/tasks/t1`, async ({ request }) => { patched(await request.json()); return HttpResponse.json({ ...task, status: 'DONE' }) }),
  )
})

async function deliverWith(completion: string) {
  // jsdom's FormData does not survive the trip to msw: answer the delivery through a spy
  vi.spyOn(api, 'post').mockResolvedValueOnce({ data: { id: 'd1', completion } })
  renderDrawer()
  fireEvent.click(await screen.findByRole('tab', { name: /Documentos/ }))
  const input = (await screen.findByText('Enviar arquivo')).closest('label')!.querySelector('input')!
  await userEvent.upload(input, new File(['%PDF'], 'holerites.pdf', { type: 'application/pdf' }))
}

it('everything delivered: asks whether to complete the task, and completes on yes', async () => {
  await deliverWith('READY')
  await userEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
  await waitFor(() => expect(patched).toHaveBeenCalledWith({ status: 'DONE' }))
})

it('"Agora não" leaves the task as it is', async () => {
  await deliverWith('READY')
  await userEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(patched).not.toHaveBeenCalled()
})

it('something still missing: no question', async () => {
  await deliverWith('PENDING')
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument()
})
