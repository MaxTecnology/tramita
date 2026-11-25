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

function renderAs(role: string, failures: object[] = [failure]) {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'X', role, organizationId: 'o1', orgName: 'G2A' }))
  server.use(http.get('http://localhost:3000/recurring-templates/failed-generations', () => HttpResponse.json(failures)))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><FailedGenerationsAlert /></MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => localStorage.clear())

it('admin vê a falha com "Abrir tarefa recorrente" e "Gerar novamente"', async () => {
  renderAs('ORG_ADMIN')
  await waitFor(() => expect(screen.getByText(/não fo(i|ram) geradas?/)).toBeInTheDocument())
  expect(screen.getByText('Abrir tarefa recorrente')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Gerar novamente' })).toBeInTheDocument()
})

it('gerente vê a falha e "Abrir cliente", mas não as ações que só o admin pode usar', async () => {
  renderAs('ORG_MANAGER')
  await waitFor(() => expect(screen.getByText(/não fo(i|ram) geradas?/)).toBeInTheDocument())
  expect(screen.getByText('Abrir cliente')).toBeInTheDocument()
  expect(screen.queryByText('Abrir tarefa recorrente')).not.toBeInTheDocument()
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

it('many failures: the first three, the rest on demand, and the way to the full list', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...failure, clientId: `c${i}`, clientName: `Cliente ${i}` }))
  renderAs('ORG_ADMIN', many)
  expect(await screen.findByText('5 tarefas recorrentes não foram geradas')).toBeInTheDocument()
  expect(screen.getAllByText(/^DAS mensal$/)).toHaveLength(3)
  expect(screen.getByRole('link', { name: 'Ver todas em Geração manual' })).toHaveAttribute('href', '/app/settings/recurring-generation')
  screen.getByRole('button', { name: 'Mostrar mais 2' }).click()
  await waitFor(() => expect(screen.getAllByText(/^DAS mensal$/)).toHaveLength(5))
})

it('one failure is said in the singular', async () => {
  renderAs('ORG_ADMIN')
  expect(await screen.findByText('1 tarefa recorrente não foi gerada')).toBeInTheDocument()
})
