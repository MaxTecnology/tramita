import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import OSModelForm from './OSModelForm'

const API = 'http://localhost:3000'

function renderForm() {
  let saved: Record<string, unknown> | null = null
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'dp', name: 'Fiscal' }])),
    http.get(`${API}/document-reader/obrigacoes`, () => HttpResponse.json([{ id: 'das', code: 'DAS', name: 'DAS' }])),
    http.post(`${API}/os-models`, async ({ request }) => { saved = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 'm1' }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/os-models/new']}>
        <Routes>
          <Route path="/app/settings/os-models/new" element={<OSModelForm />} />
          <Route path="/app/settings/os-models" element={<p>lista de modelos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { saved: () => saved }
}

it('creates an OS model with documents, robot, deadline and where it is used', async () => {
  const f = renderForm()
  await userEvent.type(await screen.findByLabelText('Nome'), 'Recálculo DAS')
  await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'dp')
  await userEvent.clear(screen.getByLabelText('Prazo interno (dias úteis)'))
  await userEvent.type(screen.getByLabelText('Prazo interno (dias úteis)'), '3')
  await userEvent.type(screen.getByLabelText('Documentos a cobrar do cliente'), 'Extrato{Enter}')
  await userEvent.type(screen.getByLabelText('Documentos a entregar ao cliente'), 'Guia DAS recalculada{Enter}')
  await userEvent.selectOptions(screen.getByLabelText('Robô de Guia DAS recalculada'), 'das')
  // A robot delivery forces "Pede competência" (the robot matches by client + obligation + competence)
  const competence = screen.getByRole('switch', { name: 'Pede competência' })
  expect(competence).toHaveAttribute('aria-checked', 'true')
  expect(competence).toBeDisabled()
  await userEvent.click(screen.getByRole('switch', { name: 'Concluir sozinha quando tudo for entregue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(f.saved()).not.toBeNull())
  expect(f.saved()).toMatchObject({
    name: 'Recálculo DAS', departmentId: 'dp', deadlineBusinessDays: 3, requiresCompetence: true,
    autoCompleteOnAllDelivered: true, usableStandalone: true, usableInProcess: false,
    documentRequests: [{ name: 'Extrato' }],
    documentDeliveries: [{ name: 'Guia DAS recalculada', obligationTypeId: 'das' }],
  })
})

it('needs at least one place where the OS is used', async () => {
  const f = renderForm()
  await userEvent.type(await screen.findByLabelText('Nome'), 'X')
  await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'dp')
  await userEvent.click(screen.getByRole('switch', { name: /Avulsa/ }))
  expect(screen.getByText('Marque onde essa OS é usada')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  expect(f.saved()).toBeNull()
})
