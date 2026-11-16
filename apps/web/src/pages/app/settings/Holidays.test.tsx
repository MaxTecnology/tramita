import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import Holidays from './Holidays'

const API = 'http://localhost:3000'
let created: unknown = null

beforeEach(() => {
  created = null
  server.use(
    http.get(`${API}/holidays`, () => HttpResponse.json({
      national: [{ date: '2026-04-03', name: 'Sexta-feira Santa' }],
      custom: [{ id: 'h1', date: '2026-01-20', name: 'São Sebastião' }],
    })),
    http.post(`${API}/holidays`, async ({ request }) => { created = await request.json(); return HttpResponse.json({ id: 'h2' }, { status: 201 }) }),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Holidays /><AppDialogs /></MemoryRouter>
    </QueryClientProvider>,
  )
}

it('shows the national holidays read-only and the office ones', async () => {
  renderPage()
  expect(await screen.findByText('Sexta-feira Santa')).toBeInTheDocument()
  expect(screen.getByText('03/04/2026')).toBeInTheDocument()
  expect(screen.getByText('São Sebastião')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /Remover/ })).toHaveLength(1)
})

it('adds an office holiday', async () => {
  renderPage()
  await screen.findByText('São Sebastião')
  await userEvent.type(screen.getByLabelText('Data'), '2026-02-16')
  await userEvent.type(screen.getByLabelText('Nome'), 'Carnaval')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar feriado' }))
  await waitFor(() => expect(created).toEqual({ date: '2026-02-16', name: 'Carnaval' }))
})
