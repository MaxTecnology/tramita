import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { FailedGenerationsAlert } from './FailedGenerationsAlert'

const failure = {
  templateId: 't1', templateTitle: 'DAS mensal', clientId: 'c1', clientName: 'ACME',
  competence: '2026-10-01T00:00:00.000Z', dueMonth: '2026-11-01T00:00:00.000Z', retryable: true,
  errorMessage: 'O departamento Fiscal não atende mais o cliente ACME.', createdAt: '2026-11-11T00:00:00.000Z',
}

function renderAs(role: string) {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'X', role, organizationId: 'o1', orgName: 'G2A' }))
  server.use(http.get('http://localhost:3000/recurring-templates/failed-generations', () => HttpResponse.json([failure])))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><FailedGenerationsAlert /></MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => localStorage.clear())

it('admin vê a falha com "Abrir template" e "Gerar novamente"', async () => {
  renderAs('ORG_ADMIN')
  await waitFor(() => expect(screen.getByText(/não foram geradas/)).toBeInTheDocument())
  expect(screen.getByText('Abrir template')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Gerar novamente' })).toBeInTheDocument()
})

it('gerente vê a falha e "Abrir cliente", mas não as ações que só o admin pode usar', async () => {
  renderAs('ORG_MANAGER')
  await waitFor(() => expect(screen.getByText(/não foram geradas/)).toBeInTheDocument())
  expect(screen.getByText('Abrir cliente')).toBeInTheDocument()
  expect(screen.queryByText('Abrir template')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Gerar novamente' })).not.toBeInTheDocument()
})

it('falha sem como reprocessar (vínculo removido / cliente desativado) não aparece no alerta', async () => {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'X', role: 'ORG_ADMIN', organizationId: 'o1', orgName: 'G2A' }))
  server.use(http.get('http://localhost:3000/recurring-templates/failed-generations', () => HttpResponse.json([{ ...failure, retryable: false }])))
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><FailedGenerationsAlert /></MemoryRouter>
    </QueryClientProvider>,
  )
  await new Promise((r) => setTimeout(r, 50))
  expect(container).toBeEmptyDOMElement()
})
