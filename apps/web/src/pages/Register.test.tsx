import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import Register from './Register'

const API = 'http://localhost:3000'

it('a paid plan asks for a valid CNPJ before sending anything', async () => {
  let posted = false
  server.use(
    http.get(`${API}/organizations/plans`, () => HttpResponse.json([{ id: 'p1', name: 'Pro', priceMonthly: '197.00', maxClients: 100, features: {} }])),
    http.post(`${API}/organizations/register`, () => { posted = true; return HttpResponse.json({}, { status: 201 }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Register /></MemoryRouter>
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: /Pro|Escolher|Assinar/ }))
  expect(screen.queryByText('(opcional)', { selector: 'label[for="cnpj"] span' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Nome do escritório/), 'G2A')
  await userEvent.type(screen.getByLabelText(/CNPJ/), '11.111.111/1111-11')
  await userEvent.type(screen.getByLabelText(/E-mail/), 'admin@g2a.com.br')
  await userEvent.type(screen.getByLabelText(/Seu nome/), 'Admin')
  await userEvent.type(screen.getByLabelText(/Senha/), 'Senha@123')
  await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
  await waitFor(() => expect(screen.getByText('CNPJ inválido')).toBeInTheDocument())
  expect(posted).toBe(false)
})
