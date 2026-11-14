import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '@/types'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
const now = new Date().toISOString()
const task: Task = {
  id: 't1', title: 'Folha de pagamento', description: null, priority: 'MEDIUM', status: 'OPEN', position: 0, columnId: 'c1',
  tags: [], creatorId: 'u0', assigneeId: 'bruna', dueDate: null, createdAt: now, updatedAt: now,
  sourceRequestId: null, departmentId: 'pessoal', competence: null, targetDate: null, recurringTemplateId: null, visibleToClient: true,
  viewerCanEdit: true,
}
const h = (action: string, actorName: string, fromValue: string | null, toValue: string | null) =>
  ({ id: action + Math.random(), taskId: 't1', action, fromValue, toValue, actorType: 'user', actorId: 'x', actorName, createdAt: now })

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

beforeEach(() => {
  server.use(
    http.get(`${API}/users/me`, () => HttpResponse.json({ id: 'bruna', role: 'ORG_MEMBER', departments: [{ id: 'pessoal', name: 'Pessoal' }], seesDepartmentWork: true })),
    http.get(`${API}/tasks/t1/history`, () => HttpResponse.json([
      h('document_uploaded', 'RH (ACME)', 'Ponto do mês', 'ponto.pdf'),
      h('document_rejected', 'Bruna', 'Ponto do mês — ponto.pdf', 'Falta a página 2'),
      h('document_not_applicable', 'RH (ACME)', null, 'Notas'),
      h('deliverable_delivered', 'Bruna', 'Holerites', 'holerites.pdf'),
    ])),
    http.get(`${API}/tasks/t1/attachments`, () => HttpResponse.json([
      { id: 'a1', filename: 'ponto.pdf', mimeType: 'application/pdf', size: 1000, uploaderName: 'RH (ACME)', signedUrl: 'https://f/1', createdAt: now, deletedAt: null, deletedByName: null,
        purpose: { kind: 'REQUIREMENT', name: 'Ponto do mês', review: 'REJECTED', rejectionReason: 'Falta a página 2', reviewedByName: 'Bruna', reviewedAt: now, current: false } },
      { id: 'a2', filename: 'ponto-v2.pdf', mimeType: 'application/pdf', size: 1000, uploaderName: 'RH (ACME)', signedUrl: 'https://f/2', createdAt: now, deletedAt: null, deletedByName: null,
        purpose: { kind: 'REQUIREMENT', name: 'Ponto do mês', review: 'PENDING_REVIEW', rejectionReason: null, reviewedByName: null, reviewedAt: null, current: true } },
    ])),
  )
})

it('the history tells the document trail in plain words', async () => {
  render(<TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />, { wrapper })
  fireEvent.click(await screen.findByRole('tab', { name: /Histórico/ }))
  expect(await screen.findByText(/enviou "Ponto do mês" \(ponto\.pdf\)/)).toBeInTheDocument()
  expect(screen.getByText(/recusou "Ponto do mês — ponto\.pdf" — motivo: Falta a página 2/)).toBeInTheDocument()
  expect(screen.getByText(/marcou "Nada a enviar" em "Notas"/)).toBeInTheDocument()
  expect(screen.getByText(/entregou "Holerites" \(holerites\.pdf\)/)).toBeInTheDocument()
})

it('each attachment says what it was for and how it ended', async () => {
  render(<TaskDrawer task={task} currentUserId="bruna" role="ORG_MEMBER" onClose={() => {}} />, { wrapper })
  fireEvent.click(await screen.findByRole('tab', { name: /Anexos/ }))
  expect(await screen.findByText(/Ponto do mês · Recusado/)).toBeInTheDocument()
  expect(screen.getByText(/Falta a página 2 — por Bruna/)).toBeInTheDocument()
  expect(screen.getByText(/Ponto do mês · Em conferência · versão atual/)).toBeInTheDocument()
})
