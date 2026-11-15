import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import RecurringTemplateForm from './RecurringTemplateForm'

const API = 'http://localhost:3000'

function renderForm() {
  let saved: Record<string, unknown> | null = null
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'dp', name: 'Pessoal' }])),
    http.get(`${API}/document-reader/obrigacoes`, () => HttpResponse.json([])),
    http.post(`${API}/recurring-templates`, async ({ request }) => { saved = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 't1' }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/recurring-templates/new']}>
        <Routes>
          <Route path="/app/settings/recurring-templates/new" element={<RecurringTemplateForm />} />
          <Route path="/app/settings/recurring-templates" element={<p>lista de templates</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { saved: () => saved }
}

it('organizes the form in sections and explains the calendar in a sentence', async () => {
  renderForm()
  for (const title of ['Identificação', 'Calendário', 'Documentos', 'Comportamento']) {
    expect(await screen.findByRole('heading', { name: new RegExp(title) })).toBeInTheDocument()
  }
  expect(screen.getByText(/Todo mês, vence no dia 10, referente ao mês anterior\./)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Trimestral' }))
  expect(screen.getByText(/A cada trimestre/)).toBeInTheDocument()
  expect(screen.getByText('Próximas gerações')).toBeInTheDocument()
})

it('saves the team instructions with the template', async () => {
  const { saved } = renderForm()
  await userEvent.type(await screen.findByLabelText('Título'), 'Folha de pagamento')
  await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'dp')
  await userEvent.type(screen.getByLabelText('Instruções para a equipe'), 'Conferir horas extras antes de fechar')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar template' }))
  await waitFor(() => expect(screen.getByText('lista de templates')).toBeInTheDocument())
  expect(saved()).toMatchObject({ title: 'Folha de pagamento', departmentId: 'dp', description: 'Conferir horas extras antes de fechar', periodicity: 'MONTHLY' })
})

it('adds several documents in a row and marks a delivery as a payment guide', async () => {
  const { saved } = renderForm()
  await userEvent.type(await screen.findByLabelText('Título'), 'Folha')
  await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'dp')
  const deliveries = screen.getByRole('textbox', { name: 'A entregar ao cliente' })
  await userEvent.type(deliveries, 'Holerites{Enter}')
  await userEvent.type(deliveries, 'Guia FGTS{Enter}')
  expect(screen.getByText('Holerites')).toBeInTheDocument()
  expect(screen.getByText('Guia FGTS')).toBeInTheDocument()
  const guides = screen.getAllByRole('button', { name: 'guia' })
  await userEvent.click(guides[1])
  expect(guides[1]).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar template' }))
  await waitFor(() => expect(saved()).not.toBeNull())
  expect(saved()!.documentDeliveries).toEqual([{ name: 'Holerites' }, { name: 'Guia FGTS', requiresPayment: true }])
})
