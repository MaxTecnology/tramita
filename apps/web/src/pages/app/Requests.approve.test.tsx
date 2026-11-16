import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
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
