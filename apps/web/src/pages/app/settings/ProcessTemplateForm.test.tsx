import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import ProcessTemplateForm from './ProcessTemplateForm'

const API = 'http://localhost:3000'
let usageAsked: string | null = null

function renderForm() {
  let saved: Record<string, unknown> | null = null
  usageAsked = null
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([{ id: 'dp', name: 'Legalização' }])),
    http.get(`${API}/os-models`, ({ request }) => {
      usageAsked = new URL(request.url).searchParams.get('usage')
      return HttpResponse.json([{ id: 'junta', name: 'Registro na Junta' }, { id: 'insc', name: 'Inscrição municipal' }])
    }),
    http.post(`${API}/process-templates`, async ({ request }) => { saved = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 't1' }) }),
  )
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/settings/process-templates/new']}>
        <Routes>
          <Route path="/app/settings/process-templates/new" element={<ProcessTemplateForm />} />
          <Route path="/app/settings/process-templates" element={<p>lista</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { saved: () => saved }
}

async function fillBasics() {
  await userEvent.type(await screen.findByLabelText('Nome'), 'Abertura de empresa')
  await userEvent.type(screen.getByPlaceholderText('Título da coluna'), 'Registro')
  await userEvent.click(screen.getByRole('button', { name: /Adicionar coluna/ }))
  await userEvent.type(screen.getAllByPlaceholderText('Título da coluna')[1], 'Prefeitura')
}

it('sends deadline, department, "cliente pode solicitar" and the OS of the process with their column and dependencies', async () => {
  const f = renderForm()
  await fillBasics()
  await userEvent.selectOptions(screen.getByLabelText('Departamento que avalia os pedidos'), 'dp')
  await userEvent.type(screen.getByLabelText('Prazo do processo (dias úteis)'), '30')
  await userEvent.click(screen.getByRole('switch', { name: 'Cliente pode solicitar' }))

  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo da OS 1'), 'junta')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo da OS 2'), 'insc')
  await userEvent.selectOptions(screen.getByLabelText('Coluna da OS 2'), '1')
  await userEvent.click(screen.getByLabelText('OS 2 depende da OS 1'))
  expect(usageAsked).toBe('process')

  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() => expect(f.saved()).not.toBeNull())
  expect(f.saved()).toMatchObject({
    departmentId: 'dp', deadlineBusinessDays: 30, clientCanRequest: true,
    items: [{ osModelId: 'junta', columnIndex: 0, dependsOn: [] }, { osModelId: 'insc', columnIndex: 1, dependsOn: [0] }],
  })
})

it('a circular dependency is shown and blocks saving', async () => {
  const f = renderForm()
  await fillBasics()
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo da OS 1'), 'junta')
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar OS' }))
  await userEvent.selectOptions(screen.getByLabelText('Modelo da OS 2'), 'insc')
  await userEvent.click(screen.getByLabelText('OS 2 depende da OS 1'))
  await userEvent.click(screen.getByLabelText('OS 1 depende da OS 2'))
  expect(screen.getByText('Dependência circular')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  expect(f.saved()).toBeNull()
})
