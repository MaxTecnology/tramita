import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { MarkPaidDialog } from './MarkPaidDialog'

const API = 'http://localhost:3000'

function renderDialog(onDone = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MarkPaidDialog protocolId="p1" amount="1234.56" open onOpenChange={() => {}} onDone={onDone} />
    </QueryClientProvider>,
  )
}

it('opens with the guide amount pre-filled and sends it in the API format', async () => {
  let received: { amount?: string } | null = null
  server.use(http.post(`${API}/portal/protocols/p1/pay`, async ({ request }) => {
    received = (await request.json()) as { amount?: string }
    return HttpResponse.json({ id: 'p1' })
  }))
  const onDone = vi.fn()
  renderDialog(onDone)

  expect(screen.getByLabelText('Valor pago')).toHaveValue('1.234,56')
  await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }))

  await waitFor(() => expect(onDone).toHaveBeenCalled())
  expect(received!.amount).toBe('1234.56')
})

it('disables the button while sending so a double click does not pay twice', async () => {
  let calls = 0
  server.use(http.post(`${API}/portal/protocols/p1/pay`, async () => {
    calls++
    await new Promise((r) => setTimeout(r, 50))
    return HttpResponse.json({ id: 'p1' })
  }))
  renderDialog()

  const button = screen.getByRole('button', { name: 'Marcar como pago' })
  await userEvent.click(button)
  expect(screen.getByRole('button', { name: /Enviando/ })).toBeDisabled()
  await waitFor(() => expect(calls).toBe(1))
})

it('shows a clear message for an invalid amount and does not call the API', async () => {
  let calls = 0
  server.use(http.post(`${API}/portal/protocols/p1/pay`, () => { calls++; return HttpResponse.json({}) }))
  renderDialog()

  const input = screen.getByLabelText('Valor pago')
  await userEvent.clear(input)
  await userEvent.type(input, '12,345')
  await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }))

  expect(screen.getByText('Valor inválido — use o formato 1.234,56')).toBeInTheDocument()
  expect(calls).toBe(0)
})
