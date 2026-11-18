import type { ReactElement } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import OSModels from './OSModels'
import ProcessTemplates from './ProcessTemplates'
import DocumentModels from './DocumentModels'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

let deleted: string | null = null
function renderAt(path: string, page: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={page} />
          <Route path={`${path}/:id/edit`} element={<p>tela de edição</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const row = async (name: string) => (await screen.findByText(name)).closest('[data-list-row]') as HTMLElement

beforeEach(() => {
  deleted = null
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/os-models`, () => HttpResponse.json([
      { id: 'm1', name: 'Certidão negativa', isActive: true, usableStandalone: true, usableInProcess: true, deadlineBusinessDays: 3, documentDeliveries: [{ obligationTypeId: 'o1' }], description: null },
      { id: 'm2', name: 'Registro na Junta', isActive: false, usableStandalone: false, usableInProcess: true, deadlineBusinessDays: null, documentDeliveries: [], description: null },
    ])),
    http.get(`${API}/process-templates`, () => HttpResponse.json([
      { id: 'p1', name: 'Abertura de empresa', isActive: true, columns: [{}, {}, {}], items: [{}, {}], deadlineBusinessDays: 10, clientCanRequest: true, description: null },
    ])),
    http.get(`${API}/document-reader/modelos`, () => HttpResponse.json([
      { id: 'd1', nome: 'DAS - Guia do Simples', version: 1, createdAt: '2026-01-01', isGlobal: true, obligationType: { id: 'o1', name: 'DAS' } },
      { id: 'd2', nome: 'Guia municipal ISS', version: 2, createdAt: '2026-01-01', isGlobal: false, obligationType: { id: 'o2', name: 'ISS' } },
    ])),
    http.delete(`${API}/:kind/:id`, ({ params }) => { deleted = String(params.id); return HttpResponse.json({}) }),
    http.delete(`${API}/document-reader/modelos/:id`, ({ params }) => { deleted = String(params.id); return HttpResponse.json({}) }),
  )
})

describe('Modelos de OS', () => {
  it('shows where it is used, the deadline and the robot; inactive marked', async () => {
    renderAt('/app/settings/os-models', <OSModels />)
    const cert = await row('Certidão negativa')
    expect(within(cert).getByText('Avulsa e em processos')).toBeInTheDocument()
    expect(within(cert).getByText('3 dias úteis')).toBeInTheDocument()
    expect(within(cert).getByText('Robô confere a entrega')).toBeInTheDocument()
    const junta = await row('Registro na Junta')
    expect(within(junta).getByText('Só em processos')).toBeInTheDocument()
    expect(within(junta).getByText('Sem prazo interno')).toBeInTheDocument()
    expect(within(junta).getByText('Inativo')).toBeInTheDocument()
  })

  it('edit is a named link; delete is in the menu and asks first', async () => {
    renderAt('/app/settings/os-models', <OSModels />)
    await userEvent.click(within(await row('Certidão negativa')).getByRole('button', { name: 'Mais ações de Certidão negativa' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    await waitFor(() => expect(deleted).toBe('m1'))
    await userEvent.click(within(await row('Registro na Junta')).getByRole('link', { name: 'Editar Registro na Junta' }))
    expect(await screen.findByText('tela de edição')).toBeInTheDocument()
  })
})

describe('Modelos de processo', () => {
  it('shows stages, OS, deadline and whether the client can request it', async () => {
    renderAt('/app/settings/process-templates', <ProcessTemplates />)
    const r = await row('Abertura de empresa')
    expect(within(r).getByText('3 etapas, 2 OS')).toBeInTheDocument()
    expect(within(r).getByText('10 dias úteis')).toBeInTheDocument()
    expect(within(r).getByText('Sim')).toBeInTheDocument()
  })
})

describe('Modelos de documento', () => {
  it('the system models are named so and cannot be changed here; the office ones can', async () => {
    renderAt('/app/settings/document-models', <DocumentModels />)
    const das = await row('DAS - Guia do Simples')
    expect(within(das).getByText('Padrão do sistema')).toBeInTheDocument()
    expect(within(das).queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument()
    const iss = await row('Guia municipal ISS')
    expect(within(iss).getByText('Do escritório')).toBeInTheDocument()
    expect(within(iss).getByText('ISS')).toBeInTheDocument()
    await userEvent.click(within(iss).getByRole('button', { name: 'Mais ações de Guia municipal ISS' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Arquivar' }))
    await waitFor(() => expect(deleted).toBe('d2'))
  })
})
