import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { Comments } from '@/components/portal/Comments'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const existingComments = [
  {
    id: 'c1',
    content: 'Processo iniciado',
    authorType: 'USER',
    user: { id: 'u1', name: 'João Escrit.' },
    client: null,
    createdAt: '2024-01-01T10:00:00.000Z',
  },
]

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('lista comentários existentes com nome do autor', async () => {
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () =>
      HttpResponse.json(existingComments),
    ),
  )
  render(<Comments taskId="task-1" currentUserId="cl1" role="CLIENT" />, { wrapper })
  await waitFor(() => expect(screen.getByText('Processo iniciado')).toBeInTheDocument())
  expect(screen.getByText('João Escrit.')).toBeInTheDocument()
})

it('submits POST /tasks/:taskId/comments com content correto', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () => HttpResponse.json([])),
    http.post('http://localhost:3000/tasks/task-1/comments', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({
        id: 'c2',
        content: 'Meu comentário',
        authorType: 'CLIENT',
        user: null,
        client: { id: 'cl1', name: 'Empresa ABC' },
        createdAt: new Date().toISOString(),
      })
    }),
  )

  render(<Comments taskId="task-1" currentUserId="cl1" role="CLIENT" />, { wrapper })
  await waitFor(() => screen.getByPlaceholderText('Adicionar comentário...'))

  const textarea = screen.getByPlaceholderText('Adicionar comentário...')
  await userEvent.type(textarea, 'Meu comentário')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ content: 'Meu comentário' })
  })
})
