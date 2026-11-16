import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { ProcessDelayReason } from './ProcessDelayReason'

const API = 'http://localhost:3000'

function renderIt(pending: boolean) {
  let sent: unknown = null
  server.use(
    http.get(`${API}/delay-reasons`, () => HttpResponse.json([{ id: 'r1', name: 'Aguardando órgão público', requiresNote: false, isActive: true, position: 0 }])),
    http.patch(`${API}/boards/b1/delay-reason`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({}) }),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProcessDelayReason boardId="b1" pending={pending} />
      <AppDialogs />
    </QueryClientProvider>,
  )
  return { sent: () => sent }
}

it('a process finished late without a reason asks for it and records it', async () => {
  const { sent } = renderIt(true)
  await userEvent.click(screen.getByRole('button', { name: 'Processo concluído com atraso — registrar o motivo' }))
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r1')
  await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
  await waitFor(() => expect(sent()).toEqual({ delayReasonId: 'r1' }))
})

it('shows nothing when no reason is pending', () => {
  renderIt(false)
  expect(screen.queryByRole('button', { name: /registrar o motivo/ })).not.toBeInTheDocument()
})
