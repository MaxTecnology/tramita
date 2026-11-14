import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { ApprovalsSection } from './ApprovalsSection'
import { api } from '@/lib/api'

const API = 'http://localhost:3000'
const pending = {
  id: 'a1', taskId: 't1', title: 'Prévia da folha', message: 'Confere?', status: 'PENDING', requestedAt: '2026-11-10T12:00:00.000Z',
  requestedByName: 'Dani', decidedAt: null, decisionNote: null, closeReason: null, waitedDays: null, decidedByName: null,
  decidedByClient: false, taskClosed: false, fileName: 'previa.pdf', fileUrl: 'https://f/previa.pdf', proofName: null, proofUrl: null,
}

function renderSection(approvals: unknown[], props: Partial<{ canEdit: boolean; visibleToClient: boolean }> = {}) {
  server.use(http.get(`${API}/tasks/t1/approvals`, () => HttpResponse.json(approvals)))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApprovalsSection taskId="t1" canEdit={props.canEdit ?? true} visibleToClient={props.visibleToClient ?? true} />
    </QueryClientProvider>,
  )
}

it('asks for approval with title, message and file', async () => {
  // jsdom's FormData does not survive the trip to msw: capture what the component sends
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: pending })
  renderSection([])
  await userEvent.click(await screen.findByRole('button', { name: 'Pedir aprovação do cliente' }))
  await userEvent.type(screen.getByLabelText('Título'), 'Prévia da folha')
  await userEvent.type(screen.getByLabelText('Mensagem (opcional)'), 'Confere?')
  await userEvent.upload(screen.getByLabelText('Arquivo'), new File(['%PDF'], 'previa.pdf', { type: 'application/pdf' }))
  await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  const [url, sent] = post.mock.calls[0] as [string, FormData]
  expect(url).toBe('/tasks/t1/approvals')
  expect(sent.get('title')).toBe('Prévia da folha')
  expect(sent.get('message')).toBe('Confere?')
  expect((sent.get('file') as File).name).toBe('previa.pdf')
  post.mockRestore()
})

it('an internal task cannot ask for approval', async () => {
  renderSection([], { visibleToClient: false })
  await waitFor(() => expect(screen.getByText(/só em tarefa visível ao cliente/)).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Pedir aprovação do cliente' })).not.toBeInTheDocument()
})

it('closes a pending approval outside the portal: reason and a mandatory note', async () => {
  let body: unknown = null
  server.use(http.post(`${API}/approvals/a1/close`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...pending, status: 'CLOSED_BY_OFFICE' }) }))
  renderSection([pending])
  expect(await screen.findByText('Aguardando aprovação do cliente')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fechar sem o portal' }))
  await userEvent.click(screen.getByLabelText('Cliente aprovou fora da plataforma'))
  const confirm = screen.getByRole('button', { name: 'Registrar fechamento' })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Observação'), 'Aprovado por WhatsApp em 12/11 às 15h')
  await userEvent.click(confirm)
  await waitFor(() => expect(body).toEqual({ reason: 'APPROVED_OUTSIDE', note: 'Aprovado por WhatsApp em 12/11 às 15h' }))
})

it('shows how a closed approval was decided', async () => {
  renderSection([{ ...pending, status: 'CLOSED_BY_OFFICE', closeReason: 'NO_RESPONSE', decisionNote: 'Cobrado 3 vezes', decidedByName: 'Dani', decidedAt: '2026-11-13T12:00:00.000Z', waitedDays: 3 }])
  expect(await screen.findByText(/Fechado pelo escritório: sem resposta do cliente/)).toBeInTheDocument()
  expect(screen.getByText(/esperou 3 dias/)).toBeInTheDocument()
  expect(screen.getByText(/Cobrado 3 vezes/)).toBeInTheDocument()
})
