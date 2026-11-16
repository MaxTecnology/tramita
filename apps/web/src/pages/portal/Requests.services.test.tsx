import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import PortalRequests from './Requests'

vi.mock('./Layout', () => ({ usePortalClient: () => ({ clientId: 'c1', clients: [{ id: 'c1', name: 'ACME' }], setClientId: () => undefined }) }))

const API = 'http://localhost:3000'
let sent: Record<string, unknown> | null = null

beforeEach(() => {
  sent = null
  server.use(
    http.get(`${API}/portal/requests`, () => HttpResponse.json([])),
    http.get(`${API}/portal/departments`, () => HttpResponse.json([{ id: 'd1', name: 'Fiscal' }])),
    http.get(`${API}/portal/services`, () => HttpResponse.json([
      { kind: 'PROCESS', id: 'p1', name: 'Abertura de empresa', description: null, departmentId: 'd2', requiresCompetence: false },
      { kind: 'OS', id: 'm1', name: 'Recálculo DAS', description: 'Guia recalculada', departmentId: 'd1', requiresCompetence: true },
    ])),
    http.post(`${API}/portal/requests`, async ({ request }) => { sent = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 'r1' }) }),
  )
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><PortalRequests /></MemoryRouter>
    </QueryClientProvider>,
  )
}

it('a service of the catalog asks for the month when needed and does not ask for the department', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Nova solicitação/ }))
  await userEvent.selectOptions(await screen.findByLabelText('Serviço'), 'OS:m1')
  expect(screen.queryByLabelText('Departamento')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Título')).toHaveValue('Recálculo DAS')
  await userEvent.type(screen.getByLabelText('Competência'), '2025-03')
  await userEvent.click(screen.getByRole('button', { name: /Enviar/ }))
  await waitFor(() => expect(sent).toMatchObject({ clientId: 'c1', title: 'Recálculo DAS', osModelId: 'm1', competence: '2025-03' }))
  expect(sent).not.toHaveProperty('departmentId')
})

it('"Outro" keeps the free request with the department', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Nova solicitação/ }))
  await screen.findByLabelText('Serviço')
  expect(screen.queryByLabelText('Competência')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Título'), 'Alterar endereço')
  await userEvent.click(screen.getByRole('button', { name: /Enviar/ }))
  await waitFor(() => expect(sent).toMatchObject({ title: 'Alterar endereço', departmentId: 'd1' }))
})

it('files chosen in the new request are sent right after it is created', async () => {
  const { api } = await import('@/lib/api')
  // jsdom's FormData does not survive msw: the uploads are checked through a spy (create goes to msw)
  const realPost = api.post.bind(api)
  const post = vi.spyOn(api, 'post').mockImplementation((url: string, body?: unknown) =>
    url.endsWith('/attachments') ? Promise.resolve({ data: {} }) : realPost(url, body))
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: /Nova solicitação/ }))
  await userEvent.type(await screen.findByLabelText('Título'), 'Alterar endereço')
  await userEvent.upload(screen.getByLabelText('Arquivos (opcional)'), [new File(['a'], 'comprovante.pdf'), new File(['b'], 'rg.pdf')])
  await userEvent.click(screen.getByRole('button', { name: /Enviar/ }))
  await waitFor(() => expect(post.mock.calls.filter(([u]) => u === '/portal/requests/r1/attachments')).toHaveLength(2))
  const names = post.mock.calls.filter(([u]) => u === '/portal/requests/r1/attachments').map(([, f]) => ((f as FormData).get('file') as File).name)
  expect(names).toEqual(['comprovante.pdf', 'rg.pdf'])
  post.mockRestore()
})
