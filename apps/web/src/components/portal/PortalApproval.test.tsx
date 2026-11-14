import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { PortalApproval } from './PortalApproval'
import type { Approval } from '@/components/shared/approvals'

const API = 'http://localhost:3000'
const pending: Approval = {
  id: 'a1', taskId: 't1', title: 'Prévia da folha de outubro', message: 'Confere os valores?', status: 'PENDING',
  requestedAt: '2026-11-10T12:00:00.000Z', requestedByName: 'Dani', decidedAt: null, decisionNote: null, closeReason: null,
  waitedDays: null, decidedByName: null, decidedByClient: false, taskClosed: false, fileName: 'previa.pdf', fileUrl: 'https://f/previa.pdf', proofName: null, proofUrl: null,
}

function renderIt(a: Approval) {
  const onChanged = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PortalApproval approval={a} onChanged={onChanged} />
    </QueryClientProvider>,
  )
  return { onChanged }
}

it('approves', async () => {
  let called = false
  server.use(http.post(`${API}/portal/approvals/a1/approve`, () => { called = true; return HttpResponse.json({ ...pending, status: 'APPROVED' }) }))
  const { onChanged } = renderIt(pending)
  expect(screen.getByRole('link', { name: 'previa.pdf' })).toHaveAttribute('href', 'https://f/previa.pdf')
  expect(screen.getByText('Confere os valores?')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
  await waitFor(() => expect(called).toBe(true))
  expect(onChanged).toHaveBeenCalled()
})

it('asking for changes needs a comment', async () => {
  let body: unknown = null
  server.use(http.post(`${API}/portal/approvals/a1/request-changes`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...pending, status: 'CHANGES_REQUESTED' }) }))
  renderIt(pending)
  await userEvent.click(screen.getByRole('button', { name: 'Pedir ajuste' }))
  const send = screen.getByRole('button', { name: 'Enviar pedido de ajuste' })
  expect(send).toBeDisabled()
  await userEvent.type(screen.getByLabelText('O que precisa ser ajustado'), 'Faltou o adicional noturno')
  await userEvent.click(send)
  await waitFor(() => expect(body).toEqual({ note: 'Faltou o adicional noturno' }))
})

it('a decided approval shows the result and no buttons', () => {
  renderIt({ ...pending, status: 'APPROVED', decidedAt: '2026-11-13T12:00:00.000Z', decidedByName: 'RH' })
  expect(screen.getByText(/Aprovado por RH em/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
})

it('a pending request on a task the office already closed shows that, without buttons', () => {
  renderIt({ ...pending, taskClosed: true })
  expect(screen.getByText(/A tarefa foi encerrada pelo escritório/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
})
