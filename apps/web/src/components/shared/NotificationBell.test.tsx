import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { NotificationBell } from './NotificationBell'

const API = 'http://localhost:3000'
const item = (id: string, readAt: string | null, link: string) => ({
  id, type: 'TASK_COMMENT', title: `Comentário ${id}`, body: 'Falta o extrato', link, readAt,
  actorName: 'Carla', createdAt: new Date().toISOString(), clientId: 'c1', taskId: 't1',
})

function renderBell(onOpen?: (n: { clientId: string | null }) => void) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <Routes>
          <Route path="/app/dashboard" element={<NotificationBell base="/app" onOpen={onOpen} />} />
          <Route path="/app/tasks" element={<p>tela de tarefas</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('mostra o número de não lidas no sino', async () => {
  server.use(http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 3 })))
  renderBell()
  await waitFor(() => expect(screen.getByRole('button', { name: /Notificações \(3 não lidas\)/ })).toBeInTheDocument())
})

it('clicar numa notificação marca como lida e abre o link', async () => {
  const read: string[] = []
  const opened: unknown[] = []
  server.use(
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 1 })),
    http.get(`${API}/notifications`, () => HttpResponse.json({ items: [item('n1', null, '/app/tasks?task=t1')], nextCursor: null })),
    http.post(`${API}/notifications/:id/read`, ({ params }) => { read.push(String(params.id)); return HttpResponse.json({ ok: true }) }),
  )
  renderBell((n) => opened.push(n))
  fireEvent.click(await screen.findByRole('button', { name: /Notificações/ }))
  fireEvent.click(await screen.findByText('Comentário n1'))
  await waitFor(() => expect(screen.getByText('tela de tarefas')).toBeInTheDocument())
  expect(read).toEqual(['n1'])
  expect(opened).toHaveLength(1)
})

it('"Marcar todas como lidas" chama a API', async () => {
  let called = false
  server.use(
    http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 2 })),
    http.get(`${API}/notifications`, () => HttpResponse.json({ items: [item('n1', null, '/app/tasks'), item('n2', null, '/app/tasks')], nextCursor: null })),
    http.post(`${API}/notifications/read-all`, () => { called = true; return HttpResponse.json({ count: 2 }) }),
  )
  renderBell()
  fireEvent.click(await screen.findByRole('button', { name: /Notificações/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }))
  await waitFor(() => expect(called).toBe(true))
})
