import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { api } from '@/lib/api'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const now = new Date().toISOString()
const task: Task = {
  id: 't1', title: 'Apuração', description: null, priority: 'MEDIUM', status: 'STARTED', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'bruna', dueDate: null, createdAt: now, updatedAt: now,
  sourceRequestId: null, departmentId: 'fiscal', competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: true,
}

beforeEach(() => {
  vi.restoreAllMocks()
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role: 'ORG_MEMBER', departments: [{ id: 'fiscal', name: 'Fiscal' }], seesDepartmentWork: true })),
    http.get(`${API}/tasks/t1/documents`, () => HttpResponse.json({ requirements: [], deliverables: [
      { id: 'd1', name: 'Guia DAS', deliveredAt: null, requiresPayment: false, amount: null, paymentDueDate: null, signedUrl: null, obligationTypeId: 'das' },
    ] })),
    http.get(`${API}/tasks/t1/approvals`, () => HttpResponse.json([])),
  )
})

// jsdom's FormData does not survive the trip to msw: answer check and upload through a spy
async function choose(check: object) {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
    ({ data: url.endsWith('/check') ? check : { id: 'd1', completion: 'PENDING' } }) as never)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />
      <AppDialogs />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('tab', { name: /Documentos/ }))
  const input = (await screen.findByText('Enviar arquivo')).closest('label')!.querySelector('input')!
  await userEvent.upload(input, new File(['%PDF'], 'guia.pdf', { type: 'application/pdf' }))
  return post
}
const uploads = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.filter(([url]) => String(url).endsWith('/upload'))
const field = (form: unknown, name: string) => (form as FormData).get(name)

it('the robot warns: shows the warnings and only delivers on "Entregar mesmo assim", flagged as accepted', async () => {
  const post = await choose({ warnings: ['Competência do documento: 09/2026 — a tarefa é de 08/2026'], read: {} })
  expect(await screen.findByText(/Competência do documento: 09\/2026 — a tarefa é de 08\/2026/)).toBeInTheDocument()
  expect(uploads(post)).toHaveLength(0)
  await userEvent.click(screen.getByRole('button', { name: 'Entregar mesmo assim' }))
  await waitFor(() => expect(uploads(post)).toHaveLength(1))
  expect(field(uploads(post)[0][1], 'acceptWarnings')).toBe('true')
})

it('giving up on the warning does not deliver', async () => {
  const post = await choose({ warnings: ['O robô não conseguiu conferir este arquivo'], read: {} })
  await userEvent.click(await screen.findByRole('button', { name: 'Escolher outro arquivo' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(uploads(post)).toHaveLength(0)
})

it('a document of another client is blocked: nothing is delivered and the reason is shown', async () => {
  const post = await choose({ blocked: 'Este documento é de BETA — não pode ser entregue a ACME', warnings: [], read: {} })
  expect(await screen.findByText('Este documento é de BETA — não pode ser entregue a ACME')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Entendi' }))
  await new Promise((r) => setTimeout(r, 50))
  expect(uploads(post)).toHaveLength(0)
})

it('no divergence: delivers straight away without asking', async () => {
  const post = await choose({ warnings: [], read: {} })
  await waitFor(() => expect(uploads(post)).toHaveLength(1))
  expect(field(uploads(post)[0][1], 'acceptWarnings')).toBeNull()
})
