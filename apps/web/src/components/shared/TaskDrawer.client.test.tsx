import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const now = new Date().toISOString()
const task: Task = {
  id: 't1', title: 'Registro na Junta', description: null, priority: 'MEDIUM', status: 'BLOCKED', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'bruna', dueDate: null, createdAt: now, updatedAt: now,
  sourceRequestId: null, departmentId: 'legal', competence: null, targetDate: null, recurringTemplateId: null,
  visibleToClient: true,
}

it('the client sees plain words for the status and the portal never asks for the office profile', async () => {
  const asked: string[] = []
  server.events.on('request:start', ({ request }) => { asked.push(new URL(request.url).pathname) })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDrawer task={task} currentUserId="cu1" role="CLIENT" onClose={() => {}} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Com pendência')).toBeInTheDocument()
  expect(screen.queryByText('Com Impedimento')).not.toBeInTheDocument()
  await new Promise((r) => setTimeout(r, 50))
  server.events.removeAllListeners()
  expect(asked).not.toContain('/users/me')
})

it('the office keeps its own words', async () => {
  server.use(http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role: 'ORG_ADMIN', departments: [], seesDepartmentWork: true })))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDrawer task={{ ...task, viewerCanEdit: false }} currentUserId="x" role="ORG_MEMBER" onClose={() => {}} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Com Impedimento')).toBeInTheDocument()
})
