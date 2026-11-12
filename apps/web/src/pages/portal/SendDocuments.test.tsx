import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { SendDocumentsView } from './SendDocuments'

const API = 'http://localhost:3000'

function setup() {
  const posted: string[] = []
  server.use(
    http.get(`${API}/portal/document-requests/months`, () => HttpResponse.json([{ competence: '2026-10', pending: 2, total: 2 }])),
    http.get(`${API}/portal/home`, () => HttpResponse.json({ documentsToSendInProcesses: 1 })),
    http.get(`${API}/portal/document-requests`, () => HttpResponse.json({
      competence: '2026-10',
      requests: [
        { id: 'r1', taskId: 't1', name: 'Extrato bancário', status: 'REJECTED', rejectionReason: 'Faltou a página 2', taskTitle: 'Apuração', departmentName: 'Fiscal' },
        { id: 'r2', taskId: 't1', name: 'Notas fiscais', status: 'PENDING', rejectionReason: null, taskTitle: 'Apuração', departmentName: 'Fiscal' },
      ],
    })),
    http.post(`${API}/portal/tasks/:taskId/documents/requests/:reqId/not-applicable`, ({ params }) => {
      posted.push(String(params.reqId))
      return HttpResponse.json({})
    }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><SendDocumentsView clientId="c1" /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { posted }
}

it('shows the rejection reason of a refused document', async () => {
  setup()
  await waitFor(() => expect(screen.getByText('Extrato bancário')).toBeInTheDocument())
  expect(screen.getByText('Faltou a página 2')).toBeInTheDocument()
})

it('"Nada a enviar" calls the not-applicable endpoint for that request', async () => {
  const { posted } = setup()
  await waitFor(() => expect(screen.getByText('Notas fiscais')).toBeInTheDocument())

  const buttons = screen.getAllByRole('button', { name: 'Nada a enviar' })
  await userEvent.click(buttons[1])

  await waitFor(() => expect(posted).toEqual(['r2']))
})

it('points to the processes when there are document requests inside a process', async () => {
  setup()
  await waitFor(() => expect(screen.getByText(/Há 1 documento pedido dentro de processos/)).toBeInTheDocument())
})
