import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TaskModal } from '@/components/TaskModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Task } from '@/types'

const task: Task = {
  id: 'task-1',
  title: 'Tarefa teste',
  priority: 'MEDIUM',
  status: 'OPEN',
  description: '',
  assigneeId: null,
  dueDate: null,
  tags: [],
  position: 0,
  columnId: 'col1',
  creatorId: 'u1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('submits PATCH /tasks/:id with correct payload on save', async () => {
  let capturedBody: unknown
  server.use(
    http.patch('http://localhost:3000/tasks/task-1', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({ ...task, title: 'Novo título' })
    }),
    http.get('http://localhost:3000/users', () => HttpResponse.json([])),
  )

  render(<TaskModal task={task} open onClose={() => {}} />, { wrapper })

  const titleInput = screen.getByLabelText('Título')
  await userEvent.clear(titleInput)
  await userEvent.type(titleInput, 'Novo título')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ title: 'Novo título' })
  })
})

it('calls onClose when cancel button is clicked', async () => {
  server.use(http.get('http://localhost:3000/users', () => HttpResponse.json([])))
  const onClose = vi.fn()
  render(<TaskModal task={task} open onClose={onClose} />, { wrapper })
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(onClose).toHaveBeenCalledOnce()
})
