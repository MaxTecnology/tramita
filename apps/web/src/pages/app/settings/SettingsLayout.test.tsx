import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import SettingsLayout from './SettingsLayout'

const API = 'http://localhost:3000'

function renderAt(path: string, role: string) {
  localStorage.setItem('user', JSON.stringify({ id: 'u1', name: 'Ana', role, organizationId: 'o1' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<SettingsLayout />}>
            <Route path="settings/departments" element={<p>conteúdo departamentos</p>} />
            <Route path="settings/recurring-templates/new" element={<p>conteúdo nova recorrente</p>} />
            <Route path="settings/client-users" element={<p>conteúdo acessos</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  server.use(http.get(`${API}/recurring-templates/failed-generations`, () => HttpResponse.json([{ templateId: 't1' }, { templateId: 't1' }])))
})

describe('menu de Configurações', () => {
  it('groups every settings page for the admin, with the page content beside it', async () => {
    renderAt('/app/settings/departments', 'ORG_ADMIN')
    const nav = screen.getByRole('navigation', { name: 'Configurações' })
    for (const group of ['Escritório', 'Portal do cliente', 'Trabalho', 'Comunicação', 'Robô de documentos']) {
      expect(within(nav).getByText(group)).toBeInTheDocument()
    }
    expect(Array.from(nav.querySelectorAll('li a')).map((l) => l.textContent?.replace(/\d+$/, ''))).toEqual([
      'Departamentos', 'Feriados', 'Assinatura', 'Acessos ao portal',
      'Tarefas recorrentes', 'Modelos de OS', 'Modelos de processo', 'Motivos de atraso', 'Geração manual',
      'Mensagens', 'Notificações', 'Modelos de documento',
    ])
    expect(screen.getByText('conteúdo departamentos')).toBeInTheDocument()
  })

  it('marks the current page, also on its sub-pages', async () => {
    renderAt('/app/settings/recurring-templates/new', 'ORG_ADMIN')
    const nav = screen.getByRole('navigation', { name: 'Configurações' })
    expect(within(nav).getByRole('link', { name: 'Tarefas recorrentes' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Departamentos' })).not.toHaveAttribute('aria-current')
  })

  it('shows the pending generation failures on Geração manual', async () => {
    renderAt('/app/settings/departments', 'ORG_ADMIN')
    expect(await screen.findByLabelText('2 gerações com falha')).toBeInTheDocument()
  })

  it('a manager only sees what a manager can open', () => {
    renderAt('/app/settings/client-users', 'ORG_MANAGER')
    const nav = screen.getByRole('navigation', { name: 'Configurações' })
    expect(Array.from(nav.querySelectorAll('li a')).map((l) => l.textContent)).toEqual(['Acessos ao portal'])
  })
})
