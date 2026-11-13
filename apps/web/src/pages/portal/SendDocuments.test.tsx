import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Link } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/server'
import { SendDocumentsView } from './SendDocuments'

const API = 'http://localhost:3000'

const TASKS = [
  {
    taskId: 't1', title: 'Apuração', departmentName: 'Fiscal', approvals: [], unreadMessages: 0,
    requests: [
      { id: 'r1', taskId: 't1', name: 'Extrato bancário', status: 'REJECTED', rejectionReason: 'Faltou a página 2', taskTitle: 'Apuração', departmentName: 'Fiscal' },
      { id: 'r2', taskId: 't1', name: 'Notas fiscais', status: 'PENDING', rejectionReason: null, taskTitle: 'Apuração', departmentName: 'Fiscal' },
    ],
  },
  {
    taskId: 't2', title: 'Folha de outubro', departmentName: 'Departamento Pessoal', unreadMessages: 2, requests: [],
    approvals: [{
      id: 'a1', taskId: 't2', title: 'Prévia da folha de outubro', message: null, status: 'PENDING', requestedAt: '2026-11-10T12:00:00.000Z',
      requestedByName: 'Dani', decidedAt: null, decisionNote: null, closeReason: null, waitedDays: null, decidedByName: null,
      decidedByClient: false, fileName: 'previa.pdf', fileUrl: 'https://f/previa.pdf', proofName: null, proofUrl: null,
    }],
  },
]

function setup(initialEntry = '/portal/send') {
  const posted: string[] = []
  const readByTask: string[] = []
  server.use(
    http.get(`${API}/portal/document-requests/months`, () => HttpResponse.json([{ competence: '2026-10', pending: 2, total: 2 }])),
    http.get(`${API}/portal/home`, () => HttpResponse.json({ documentsToSendInProcesses: 1 })),
    http.get(`${API}/portal/document-requests`, () => HttpResponse.json({ competence: '2026-10', tasks: TASKS })),
    http.get(`${API}/tasks/:taskId/comments`, () => HttpResponse.json([
      { id: 'c1', content: 'Confere a prévia, por favor', authorType: 'USER', createdAt: '2026-11-10T12:00:00.000Z', user: { id: 'u1', name: 'Dani' }, client: null, deletedAt: null },
    ])),
    http.post(`${API}/notifications/read-by-task`, async ({ request }) => {
      readByTask.push(((await request.json()) as { taskId: string }).taskId)
      return HttpResponse.json({ count: 2 })
    }),
    http.post(`${API}/portal/tasks/:taskId/documents/requests/:reqId/not-applicable`, ({ params }) => {
      posted.push(String(params.reqId))
      return HttpResponse.json({})
    }),
  )
  localStorage.setItem('user', JSON.stringify({ id: 'cu1', name: 'Financeiro', role: 'CLIENT', organizationId: 'o1', orgName: 'G2A' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}><SendDocumentsView clientId="c1" /></MemoryRouter>
    </QueryClientProvider>,
  )
  return { posted, readByTask }
}

afterEach(() => localStorage.clear())

it('groups the month by task, with the department, including a task that only has a conversation', async () => {
  setup()
  await waitFor(() => expect(screen.getByText('Apuração — Fiscal')).toBeInTheDocument())
  expect(screen.getByText('Folha de outubro — Departamento Pessoal')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Conversa (2 não lidas)' })).toBeInTheDocument()
})

it('opening the conversation shows the comments and marks them as read', async () => {
  const { readByTask } = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Conversa (2 não lidas)' }))
  await waitFor(() => expect(screen.getByText('Confere a prévia, por favor')).toBeInTheDocument())
  await waitFor(() => expect(readByTask).toEqual(['t2']))
})

it('a notification link (?task=) opens that conversation directly', async () => {
  const { readByTask } = setup('/portal/send?competence=2026-10&task=t2')
  await waitFor(() => expect(screen.getByText('Confere a prévia, por favor')).toBeInTheDocument())
  expect(readByTask).toEqual(['t2'])
})

it('shows the rejection reason of a refused document', async () => {
  setup()
  await waitFor(() => expect(screen.getByText('Extrato bancário')).toBeInTheDocument())
  expect(screen.getByText('Faltou a página 2')).toBeInTheDocument()
})

it('"Nada a enviar" calls the not-applicable endpoint for that request', async () => {
  const { posted } = setup()
  await waitFor(() => expect(screen.getByText('Notas fiscais')).toBeInTheDocument())

  const buttons = screen.getAllByRole('button', { name: 'Nada a enviar' })
  await userEvent.click(buttons[1])

  await waitFor(() => expect(posted).toEqual(['r2']))
})

it('points to the processes when there are document requests inside a process', async () => {
  setup()
  await waitFor(() => expect(screen.getByText(/Há 1 documento pedido dentro de processos/)).toBeInTheDocument())
})

it('shows the approval request inside its task group with Aprovar and Pedir ajuste', async () => {
  setup()
  await waitFor(() => expect(screen.getByText('Prévia da folha de outubro')).toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pedir ajuste' })).toBeInTheDocument()
})

it('a notification for another month, clicked while already on the page, switches the month and opens the conversation', async () => {
  const readByTask: string[] = []
  server.use(
    http.get(`${API}/portal/document-requests/months`, () => HttpResponse.json([{ competence: '2026-10', pending: 0, total: 0 }, { competence: '2026-09', pending: 0, total: 0 }])),
    http.get(`${API}/portal/home`, () => HttpResponse.json({ documentsToSendInProcesses: 0 })),
    http.get(`${API}/portal/document-requests`, ({ request }) => {
      const competence = new URL(request.url).searchParams.get('competence')
      return HttpResponse.json({
        competence,
        tasks: competence === '2026-09'
          ? [{ taskId: 't9', title: 'Folha de setembro', departmentName: 'Pessoal', approvals: [], unreadMessages: 1, requests: [] }]
          : TASKS,
      })
    }),
    http.get(`${API}/tasks/:taskId/comments`, () => HttpResponse.json([
      { id: 'c9', content: 'Mensagem de setembro', authorType: 'USER', createdAt: '2026-09-10T12:00:00.000Z', user: { id: 'u1', name: 'Dani' }, client: null, deletedAt: null },
    ])),
    http.post(`${API}/notifications/read-by-task`, async ({ request }) => {
      readByTask.push(((await request.json()) as { taskId: string }).taskId)
      return HttpResponse.json({ count: 1 })
    }),
  )
  localStorage.setItem('user', JSON.stringify({ id: 'cu1', name: 'Financeiro', role: 'CLIENT', organizationId: 'o1', orgName: 'G2A' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/portal/send']}>
        <Link to="/portal/send?competence=2026-09&task=t9">abrir notificação</Link>
        <SendDocumentsView clientId="c1" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByText('Apuração — Fiscal')).toBeInTheDocument())
  await userEvent.click(screen.getByText('abrir notificação'))
  await waitFor(() => expect(screen.getByText('Mensagem de setembro')).toBeInTheDocument())
  expect(readByTask).toEqual(['t9'])
})
