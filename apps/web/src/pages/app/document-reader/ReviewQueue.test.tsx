import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import ReviewQueue from './ReviewQueue'

const API = 'http://localhost:3000'
const doc = (id: string, ready: boolean, extra: object = {}) => ({
  id, status: 'PENDING', documentModelId: 'm', confidence: 0.97, extractedFields: {}, taskId: `t-${id}`, how: null,
  filename: `${id}.pdf`, createdAt: '2026-11-15T12:00:00.000Z',
  task: { id: `t-${id}`, title: 'Apuração', competence: '2026-10-01T00:00:00.000Z', client: { name: 'ACME' }, pendingDeliverables: [{ id: `d-${id}`, name: 'Guia DAS', requiresPayment: true }] },
  suggestion: {
    taskId: `t-${id}`, taskTitle: 'Apuração', clientName: 'ACME', competence: '2026-10', deliverableId: `d-${id}`, deliverableName: 'Guia DAS',
    obligationName: 'DAS', requiresPayment: true, amount: ready ? '1234.56' : null, paymentDueDate: ready ? '2026-11-20' : null,
  },
  checks: { cnpj: true, competence: true, payment: ready },
  ready,
  ...extra,
})

let bulk: string[] | null = null
const completed: string[] = []
beforeEach(() => {
  bulk = null
  completed.length = 0
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role: 'ORG_ADMIN', organizationId: 'o1' }))
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'u1', role: 'ORG_ADMIN', departments: [], seesDepartmentWork: true })),
    http.get(`${API}/document-reader/fila`, () => HttpResponse.json([doc('a', true), doc('b', true), doc('c', false)])),
    http.post(`${API}/document-reader/confirmar-lote`, async ({ request }) => {
      bulk = ((await request.json()) as { ids: string[] }).ids
      return HttpResponse.json({
        results: [{ id: 'a', ok: true, taskId: 't-a', completion: 'READY' }, { id: 'b', ok: false, error: 'O CNPJ lido no documento não bate' }],
        summary: { delivered: 1, completed: 0, readyTaskIds: ['t-a'], failed: 1 },
      })
    }),
    http.patch(`${API}/tasks/:id`, ({ params }) => { completed.push(String(params.id)); return HttpResponse.json({}) }),
  )
})

function renderQueue() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ReviewQueue /><AppDialogs /></MemoryRouter>
    </QueryClientProvider>,
  )
}

it('each document shows where it goes and the robot checks', async () => {
  renderQueue()
  expect(await screen.findAllByText('DAS → Guia DAS')).toHaveLength(3)
  expect(screen.getAllByText(/✓ CNPJ/)).toHaveLength(3)
  expect(screen.getAllByText(/⚠ Valor e vencimento/)).toHaveLength(1)
})

it('confirms only the ones without pending items, shows the summary and completes the ready tasks', async () => {
  renderQueue()
  await userEvent.click(await screen.findByRole('button', { name: 'Confirmar os 2 sem pendência' }))
  await waitFor(() => expect(bulk).toEqual(['a', 'b']))
  expect(await screen.findByText(/1 entregue/)).toBeInTheDocument()
  expect(screen.getByText(/O CNPJ lido no documento não bate/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Concluir 1 tarefa pronta' }))
  await waitFor(() => expect(completed).toEqual(['t-a']))
})
