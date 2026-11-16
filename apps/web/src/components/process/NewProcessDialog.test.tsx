import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it } from 'vitest'
import { server } from '@/test/server'
import { NewProcessDialog } from './NewProcessDialog'

const API = 'http://localhost:3000'
let created: Record<string, unknown> | null = null

const template = (id: string, name: string, osModelIds: string[], isActive = true) => ({
  id, name, isActive, deadlineBusinessDays: 10, columns: [{ title: 'A fazer' }, { title: 'Feito' }],
  items: osModelIds.map((m, i) => ({ id: `${id}-i${i}`, osModelId: m, osModel: { id: m, name: m }, columnPosition: 0, position: i, dependsOn: [] })),
})

beforeEach(() => {
  created = null
  server.use(
    http.get(`${API}/clients`, () => HttpResponse.json([{ id: 'c1', name: 'ACME', codigo: '320' }])),
    http.get(`${API}/process-templates`, () => HttpResponse.json([
      template('p1', 'Abertura de empresa', ['m1', 'm2']),
      template('p2', 'Recálculo mensal', ['m3']),
      template('p3', 'Modelo inativo', [], false),
    ])),
    http.get(`${API}/os-models`, () => HttpResponse.json([
      { id: 'm1', name: 'Registro', requiresCompetence: false },
      { id: 'm2', name: 'Alvará', requiresCompetence: false },
      { id: 'm3', name: 'Recálculo', requiresCompetence: true },
    ])),
    http.post(`${API}/boards`, async ({ request }) => {
      created = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ id: 'b9' }, { status: 201 })
    }),
  )
})

async function chooseModel(name: string) {
  await screen.findByRole('option', { name })
  await userEvent.selectOptions(screen.getByLabelText('Modelo de processo'), name)
}

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/processes']}>
        <Routes>
          <Route path="/app/processes" element={<NewProcessDialog open onClose={() => {}} />} />
          <Route path="/app/board/:id" element={<p>board aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('opens a process from a model: title comes from the model and the OS count is shown', async () => {
  renderDialog()
  const modelSelect = await screen.findByLabelText('Modelo de processo')
  await waitFor(() => expect(Array.from((modelSelect as HTMLSelectElement).options).map((o) => o.textContent))
    .toEqual(['Sem modelo (3 colunas padrão)', 'Abertura de empresa', 'Recálculo mensal']))
  await userEvent.selectOptions(modelSelect, 'p1')
  expect(screen.getByLabelText('Título do processo')).toHaveValue('Abertura de empresa')
  expect(screen.getByText(/2 colunas e 2 OS do modelo/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  await userEvent.click(screen.getByRole('button', { name: 'Criar processo' }))
  await waitFor(() => expect(created).toEqual({ title: 'Abertura de empresa', clientId: 'c1', processTemplateId: 'p1' }))
  expect(await screen.findByText('board aberto')).toBeInTheDocument()
})

it('asks the month when an OS of the model needs one', async () => {
  renderDialog()
  await chooseModel('Recálculo mensal')
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  expect(screen.getByRole('button', { name: 'Criar processo' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Competência'), '2025-03')
  await userEvent.click(screen.getByRole('button', { name: 'Criar processo' }))
  await waitFor(() => expect(created).toEqual({ title: 'Recálculo mensal', clientId: 'c1', processTemplateId: 'p2', competence: '2025-03' }))
})

it('without a model it keeps the default columns', async () => {
  renderDialog()
  await screen.findByLabelText('Modelo de processo')
  expect(screen.getByText(/3 colunas padrão serão criadas/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Título do processo'), 'Avulso')
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  await userEvent.click(screen.getByRole('button', { name: 'Criar processo' }))
  await waitFor(() => expect(created).toEqual({ title: 'Avulso', clientId: 'c1' }))
})

it('shows the server reason when opening fails', async () => {
  server.use(http.post(`${API}/boards`, () => HttpResponse.json({ message: 'Modelo de OS inativo' }, { status: 422 })))
  renderDialog()
  await chooseModel('Abertura de empresa')
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  await userEvent.click(screen.getByRole('button', { name: 'Criar processo' }))
  expect(await screen.findByText('Modelo de OS inativo')).toBeInTheDocument()
})

it('does not let a model be opened while it is unknown whether its OS need the month', async () => {
  server.use(http.get(`${API}/os-models`, () => HttpResponse.json({ message: 'falhou' }, { status: 500 })))
  renderDialog()
  await chooseModel('Recálculo mensal')
  await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'c1')
  expect(await screen.findByText(/Não foi possível carregar os modelos de OS/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Criar processo' })).toBeDisabled()
})
