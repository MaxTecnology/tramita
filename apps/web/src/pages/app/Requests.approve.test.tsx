import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import Requests from './Requests'

const API = 'http://localhost:3000'
let approved: unknown = null
const request = (extra: object) => ({
  id: 'r1', title: 'Recálculo DAS', description: null, status: 'PENDING', rejectionReason: null, taskId: null, boardId: null,
  departmentId: 'd1', cancelledByType: null, cancellationReason: null, createdAt: '2026-11-15T12:00:00.000Z',
  client: { id: 'c1', name: 'ACME' }, department: { id: 'd1', name: 'Fiscal' }, comments: [], attachments: [],
  osModelId: null, processTemplateId: null, competence: null, ...extra,
})

function renderPage(req: object) {
  approved = null
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Bruna', role: 'ORG_ADMIN', organizationId: 'o1' }))
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'u1', role: 'ORG_ADMIN', departments: [], seesDepartmentWork: true })),
    http.get(`${API}/requests`, () => HttpResponse.json([request(req)])),
    http.get(`${API}/os-models`, () => HttpResponse.json([{ id: 'm1', name: 'Recálculo DAS' }, { id: 'm2', name: 'Certidão' }])),
    http.post(`${API}/requests/r1/approve`, async ({ request: r }) => { approved = await r.json(); return HttpResponse.json({}) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Requests /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => localStorage.clear())

it('a request for an OS opens as that OS by default', async () => {
  renderPage({ osModelId: 'm1', competence: '2025-03-01T00:00:00.000Z' })
  await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
  expect(screen.getByRole('button', { name: 'Abrir como OS' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByLabelText('Modelo de OS')).toHaveValue('m1')
  await userEvent.click(screen.getAllByRole('button', { name: 'Aprovar' }).at(-1)!)
  await waitFor(() => expect(approved).toEqual({ mode: 'OS', osModelId: 'm1' }))
})

it('a free request can be opened as an OS chosen by the office', async () => {
  renderPage({})
  await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
  await userEvent.click(screen.getByRole('button', { name: 'Abrir como OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm2')
  await userEvent.click(screen.getAllByRole('button', { name: 'Aprovar' }).at(-1)!)
  await waitFor(() => expect(approved).toEqual({ mode: 'OS', osModelId: 'm2' }))
})

it('a request for a process model says the process opens from that model', async () => {
  renderPage({ title: 'Abertura de empresa', processTemplateId: 'p1', processTemplate: { id: 'p1', name: 'Abertura de empresa' } })
  await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
  expect(screen.getByText(/Será aberto o processo do modelo "Abertura de empresa"/)).toBeInTheDocument()
  expect(screen.queryByText(/3 colunas padrão/)).not.toBeInTheDocument()
})

it('a free request still says the new process gets the default columns', async () => {
  renderPage({})
  await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }))
  expect(screen.getByText(/3 colunas padrão/)).toBeInTheDocument()
})

it('the office sees and downloads the files the client attached', async () => {
  renderPage({ attachments: [{ id: 'a1', filename: 'contrato-social.pdf', mimeType: 'application/pdf', size: 5120, createdAt: '2026-11-15T12:00:00.000Z', url: 'https://signed.example/cs' }] })
  expect(await screen.findByRole('link', { name: /contrato-social\.pdf/ })).toHaveAttribute('href', 'https://signed.example/cs')
  expect(screen.queryByText('Anexar arquivo')).not.toBeInTheDocument()
})

it('standard header; each request says when it arrived', async () => {
  renderPage({})
  expect(await screen.findByRole('heading', { name: 'Solicitações' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Pendentes' })).toHaveAttribute('aria-checked', 'true')
  expect(await screen.findByText(/Recebida em 15\/11\/2026/)).toBeInTheDocument()
  expect(screen.getByLabelText('Buscar solicitações')).toBeInTheDocument()
})

it('counts in Portuguese and keeps the page while another situation loads', async () => {
  renderPage({})
  server.use(http.get(`${API}/requests`, async ({ request: req }) => {
    const status = new URL(req.url).searchParams.get('status')
    if (status === 'APPROVED') { await delay(300); return HttpResponse.json([]) }
    return HttpResponse.json([request({}), request({ id: 'r2', title: 'Outra' })])
  }))
  await userEvent.click(await screen.findByRole('radio', { name: 'Todas' }))
  expect(await screen.findByText('2 solicitações')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Aprovadas' }))
  expect(screen.getByRole('heading', { name: 'Solicitações' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Aprovadas' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByLabelText('Recebidas até')).toBeInTheDocument()
})
