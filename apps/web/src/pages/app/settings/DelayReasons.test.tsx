import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import DelayReasons from './DelayReasons'

const API = 'http://localhost:3000'
let created: unknown = null
let patched: unknown = null

beforeEach(() => {
  created = null
  patched = null
  server.use(
    http.get(`${API}/delay-reasons`, () => HttpResponse.json([
      { id: 'r1', name: 'Aguardando órgão público', requiresNote: false, isActive: true, position: 0 },
      { id: 'r4', name: 'Outro', requiresNote: true, isActive: true, position: 1 },
    ])),
    http.post(`${API}/delay-reasons`, async ({ request }) => { created = await request.json(); return HttpResponse.json({ id: 'r5' }, { status: 201 }) }),
    http.patch(`${API}/delay-reasons/:id`, async ({ request }) => { patched = await request.json(); return HttpResponse.json({}) }),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DelayReasons /><AppDialogs /></MemoryRouter>
    </QueryClientProvider>,
  )
}

it('lists the reasons and which ones ask for a note', async () => {
  renderPage()
  expect(await screen.findByText('Aguardando órgão público')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Pede observação: Outro' })).toHaveAttribute('aria-checked', 'true')
})

it('adds a reason and toggles "pede observação"', async () => {
  renderPage()
  await screen.findByText('Outro')
  await userEvent.type(screen.getByLabelText('Novo motivo'), 'Cliente sem certificado')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar motivo' }))
  await waitFor(() => expect(created).toEqual({ name: 'Cliente sem certificado', requiresNote: false }))
  await userEvent.click(screen.getByRole('switch', { name: 'Pede observação: Aguardando órgão público' }))
  await waitFor(() => expect(patched).toEqual({ requiresNote: true }))
})
