import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { AddOSDialog } from './AddOSDialog'

const API = 'http://localhost:3000'
let added: Record<string, unknown> | null = null
let closed = false

const task = (id: string, title: string, extra: object = {}) => ({ id, title, status: 'OPEN', osModelId: 'mx', ...extra })
const board = {
  id: 'b1',
  columns: [
    { id: 'col1', title: 'A fazer', position: 0, tasks: [task('t1', 'Registro na Junta'), task('t2', 'Tarefa livre', { osModelId: null }), task('t3', 'Viabilidade', { status: 'DONE' })] },
    { id: 'col2', title: 'Concluído', position: 1, tasks: [] },
  ],
}

beforeEach(() => {
  added = null
  closed = false
  server.use(
    http.get(`${API}/os-models`, () => HttpResponse.json([
      { id: 'm1', name: 'Alvará', requiresCompetence: false, usableInProcess: true, isActive: true },
      { id: 'm2', name: 'Recálculo', requiresCompetence: true, usableInProcess: true, isActive: true },
      { id: 'm3', name: 'Só avulsa', requiresCompetence: false, usableInProcess: false, isActive: true },
      { id: 'm4', name: 'Inativa', requiresCompetence: false, usableInProcess: true, isActive: false },
    ])),
    http.post(`${API}/boards/b1/os`, async ({ request }) => {
      added = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ id: 't9' }, { status: 201 })
    }),
  )
})

function renderDialog(b: object = board) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {/* @ts-expect-error minimal board for the dialog */}
      <AddOSDialog open board={b} onClose={() => { closed = true }} />
    </QueryClientProvider>,
  )
}

it('adds an OS used in processes, in a column, waiting for an open OS of the process', async () => {
  renderDialog()
  await screen.findByRole('option', { name: 'Alvará' })
  const models = Array.from((screen.getByLabelText('Modelo de OS') as HTMLSelectElement).options).map((o) => o.textContent)
  expect(models).toEqual(['Selecione', 'Alvará', 'Recálculo'])
  // Only open OS of this process can be waited for (not free tasks, not finished OS)
  expect(screen.getByRole('checkbox', { name: 'Registro na Junta' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Tarefa livre' })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Viabilidade' })).not.toBeInTheDocument()

  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm1')
  await userEvent.selectOptions(screen.getByLabelText('Coluna'), 'col2')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Registro na Junta' }))
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await waitFor(() => expect(added).toEqual({ osModelId: 'm1', columnId: 'col2', dependsOnTaskIds: ['t1'] }))
  await waitFor(() => expect(closed).toBe(true))
})

it('asks the month for a model of a period', async () => {
  renderDialog()
  await screen.findByRole('option', { name: 'Recálculo' })
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm2')
  expect(screen.getByRole('button', { name: 'Adicionar OS' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Competência'), '2025-03')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await waitFor(() => expect(added).toEqual({ osModelId: 'm2', columnId: 'col1', dependsOnTaskIds: [], competence: '2025-03' }))
})

it('shows the server reason when it refuses', async () => {
  server.use(http.post(`${API}/boards/b1/os`, () => HttpResponse.json({ message: 'O departamento não atende este cliente' }, { status: 422 })))
  renderDialog()
  await screen.findByRole('option', { name: 'Alvará' })
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm1')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  expect(await screen.findByText('O departamento não atende este cliente')).toBeInTheDocument()
})

it('in a process of a month, an OS of a period takes that month unless another is typed', async () => {
  renderDialog({ ...board, competence: '2026-10-01T00:00:00.000Z' })
  await screen.findByRole('option', { name: 'Recálculo' })
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm2')
  expect(screen.getByText(/Vazio = a do processo \(10\/2026\)/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await waitFor(() => expect(added).toEqual({ osModelId: 'm2', columnId: 'col1', dependsOnTaskIds: [] }))
})

it('reopening after a refusal does not show the old error', async () => {
  server.use(http.post(`${API}/boards/b1/os`, () => HttpResponse.json({ message: 'Recusado' }, { status: 422 })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { rerender } = render(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error minimal board for the dialog */}
      <AddOSDialog open board={board} onClose={() => {}} />
    </QueryClientProvider>,
  )
  await screen.findByRole('option', { name: 'Alvará' })
  await userEvent.selectOptions(screen.getByLabelText('Modelo de OS'), 'm1')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  expect(await screen.findByText('Recusado')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  rerender(
    <QueryClientProvider client={qc}>
      {/* @ts-expect-error minimal board for the dialog */}
      <AddOSDialog open board={board} onClose={() => {}} />
    </QueryClientProvider>,
  )
  expect(screen.queryByText('Recusado')).not.toBeInTheDocument()
})
