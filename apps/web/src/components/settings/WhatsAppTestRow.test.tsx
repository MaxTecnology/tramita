import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import { WhatsAppTestRow } from './WhatsAppTestRow'

const API = 'http://localhost:3000'

function renderRow(hasToken = true) {
  let sent: unknown = null
  server.use(http.post(`${API}/notifications/config/test-whatsapp`, async ({ request }) => { sent = await request.json(); return HttpResponse.json({ ok: true }) }))
  render(<QueryClientProvider client={new QueryClient()}><WhatsAppTestRow hasSavedToken={hasToken} /></QueryClientProvider>)
  return { sent: () => sent }
}

it('sends a test WhatsApp to the number typed', async () => {
  const { sent } = renderRow()
  await userEvent.type(screen.getByLabelText('Enviar WhatsApp de teste'), '(82) 99999-1234')
  await userEvent.click(screen.getByRole('button', { name: 'Testar WhatsApp' }))
  await waitFor(() => expect(sent()).toEqual({ number: '(82) 99999-1234' }))
})

it('shows the provider refusal so the office knows what to fix', async () => {
  renderRow()
  server.use(http.post(`${API}/notifications/config/test-whatsapp`, () => HttpResponse.json({ message: 'Não foi possível enviar o WhatsApp de teste: o MaximizeBot recusou o envio (401).' }, { status: 502 })))
  await userEvent.type(screen.getByLabelText('Enviar WhatsApp de teste'), '82999991234')
  await userEvent.click(screen.getByRole('button', { name: 'Testar WhatsApp' }))
  expect(await screen.findByText(/MaximizeBot recusou o envio \(401\)/)).toBeInTheDocument()
})

it('asks to save the token first when none is saved', () => {
  renderRow(false)
  expect(screen.getByText('Salve o token antes de testar.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Testar WhatsApp' })).toBeDisabled()
})
