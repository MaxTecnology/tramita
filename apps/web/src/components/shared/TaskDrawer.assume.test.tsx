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
  id: 't1', title: 'Apuração', description: null, priority: 'MEDIUM', status: 'OPEN', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'carlos', dueDate: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  sourceRequestId: null, departmentId: 'fiscal', competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: false,
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

const assumeBody = vi.fn()

beforeEach(() => {
  assumeBody.mockReset()
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role: 'ORG_MEMBER', departments: [{ id: 'fiscal', name: 'Fiscal' }], seesDepartmentWork: true })),
    http.get(`${API}/tasks/t1/comments`, () => HttpResponse.json([])),
    http.get(`${API}/departments/served`, () => HttpResponse.json([])),
  )
})

it("a colleague's task is read-only and offers Assumir", async () => {
  render(<TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />, { wrapper })
  expect(await screen.findByRole('button', { name: 'Assumir' })).toBeInTheDocument()
  expect(screen.getByText('Assuma a tarefa para alterá-la')).toBeInTheDocument()
  expect(screen.queryAllByRole('combobox')).toHaveLength(0) // priority/status/department shown as text
})

it('Assumir sends the assignee the screen showed', async () => {
  server.use(http.post(`${API}/tasks/t1/assume`, async ({ request }) => {
    assumeBody(await request.json())
    return HttpResponse.json({ ...task, assigneeId: 'bruna' })
  }))
  render(<TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'Assumir' }))
  await waitFor(() => expect(assumeBody).toHaveBeenCalledWith({ expectedAssigneeId: 'carlos' }))
})

it('a race (409) shows the API message', async () => {
  server.use(http.post(`${API}/tasks/t1/assume`, () => HttpResponse.json({ message: 'Essa tarefa já foi assumida por outra pessoa' }, { status: 409 })))
  render(<TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'Assumir' }))
  expect(await screen.findByText('Essa tarefa já foi assumida por outra pessoa')).toBeInTheDocument()
})
