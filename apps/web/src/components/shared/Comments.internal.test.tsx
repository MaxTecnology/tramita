import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import { Comments } from './Comments'

const API = 'http://localhost:3000'
const comment = (id: string, content: string, isInternal: boolean) => ({
  id, content, isInternal, authorType: 'USER', user: { id: 'u1', name: 'Bruna' }, client: null,
  deletedAt: null, deletedBy: null, deletedByType: null, createdAt: '2026-11-16T12:00:00.000Z',
})

function renderComments(allowInternal: boolean) {
  let sent: unknown = null
  server.use(
    http.get(`${API}/tasks/t1/comments`, () => HttpResponse.json([comment('c1', 'Cobrar o cliente amanhã', true), comment('c2', 'Recebemos', false)])),
    http.post(`${API}/tasks/t1/comments`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({}, { status: 201 }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Comments entityType="task" entityId="t1" currentUserId="u1" role="ORG_MEMBER" allowInternal={allowInternal} />
    </QueryClientProvider>,
  )
  return { sent: () => sent }
}

it('the office marks a comment as internal and sees which ones are', async () => {
  const { sent } = renderComments(true)
  expect(await screen.findByText('Interno')).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText('Adicionar comentário...'), 'Só para a equipe')
  await userEvent.click(screen.getByLabelText('Interno (o cliente não vê)'))
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(sent()).toEqual({ content: 'Só para a equipe', isInternal: true }))
})

it('a normal comment goes without the mark', async () => {
  const { sent } = renderComments(true)
  await userEvent.type(await screen.findByPlaceholderText('Adicionar comentário...'), 'Recebemos o extrato')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await waitFor(() => expect(sent()).toEqual({ content: 'Recebemos o extrato' }))
})

it('without the option (portal, or a task the client does not see) there is no internal switch', async () => {
  renderComments(false)
  await screen.findByPlaceholderText('Adicionar comentário...')
  expect(screen.queryByLabelText('Interno (o cliente não vê)')).not.toBeInTheDocument()
})
