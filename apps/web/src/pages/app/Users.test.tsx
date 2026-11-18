import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Users from './Users'

const API = 'http://localhost:3000'

const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

const DEPARTMENTS = [{ id: 'fiscal', name: 'Fiscal' }, { id: 'legal', name: 'Legalização' }]
const ACTIVE = [
  { id: 'u1', name: 'Ana Souza', email: 'ana@x.com', role: 'ORG_ADMIN', phone: null, isActive: true, createdAt: '2026-01-01', departments: [], seesDepartmentWork: true },
  { id: 'u2', name: 'Bruno Lima', email: 'bruno@x.com', role: 'ORG_MEMBER', phone: '(82) 99999-1234', isActive: true, createdAt: '2026-01-02', departments: [DEPARTMENTS[0], DEPARTMENTS[1]], seesDepartmentWork: true },
  { id: 'u3', name: 'Carla Dias', email: 'carla@x.com', role: 'ORG_MANAGER', phone: null, isActive: true, createdAt: '2026-01-03', departments: [DEPARTMENTS[1]], seesDepartmentWork: false },
]
const INACTIVE = [
  { id: 'u9', name: 'Davi Antigo', email: 'davi@x.com', role: 'ORG_MEMBER', phone: null, isActive: false, createdAt: '2025-01-01', departments: [DEPARTMENTS[0]], seesDepartmentWork: false },
]

const calls: { method: string; url: string; body?: unknown }[] = []
let listFetches = 0

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/users']}>
        <Routes>
          <Route path="/app/users" element={<Users />} />
          <Route path="/app/users/:id/transfer" element={<p>tela de transferência</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  calls.length = 0
  listFetches = 0
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/users`, ({ request }) => { listFetches++; return HttpResponse.json(new URL(request.url).searchParams.get('status') === 'inactive' ? INACTIVE
      // From the second load on, someone else added a person meanwhile
      : listFetches > 1 ? [...ACTIVE, { ...ACTIVE[1], id: 'u5', name: 'Eva Nova', email: 'eva@x.com' }] : ACTIVE) }),
    http.get(`${API}/departments`, () => HttpResponse.json(DEPARTMENTS)),
    http.post(`${API}/users`, async ({ request }) => {
      const body = await request.json()
      calls.push({ method: 'POST', url: '/users', body })
      return HttpResponse.json({ id: 'u4', name: 'Nova Pessoa', email: 'nova@x.com', role: 'ORG_MEMBER', isActive: true, temporaryPassword: 'Tmp-9f2k-ab7Q' }, { status: 201 })
    }),
    http.patch(`${API}/users/:id`, async ({ request, params }) => { calls.push({ method: 'PATCH', url: `/users/${params.id}`, body: await request.json() }); return HttpResponse.json({}) }),
    http.delete(`${API}/users/:id`, ({ params }) => { calls.push({ method: 'DELETE', url: `/users/${params.id}` }); return HttpResponse.json({}) }),
    http.post(`${API}/users/:id/reactivate`, ({ params }) => { calls.push({ method: 'POST', url: `/users/${params.id}/reactivate` }); return HttpResponse.json({}) }),
    http.post(`${API}/users/:id/reset-password`, () => HttpResponse.json({ temporaryPassword: 'Reset-1234-xyZ' })),
  )
})

describe('tela de usuários', () => {
  it('lists each person with profile and access: departments and whether they see the team work', async () => {
    renderPage()
    const bruno = (await screen.findByText('Bruno Lima')).closest('[data-user-row]') as HTMLElement
    expect(within(bruno).getByText('Colaborador')).toBeInTheDocument()
    expect(within(bruno).getByText('Fiscal')).toBeInTheDocument()
    expect(within(bruno).getByText('Legalização')).toBeInTheDocument()
    expect(within(bruno).getByText('Vê o trabalho da equipe')).toBeInTheDocument()
    expect(within(bruno).getByText('(82) 99999-1234')).toBeInTheDocument()
    const carla = screen.getByText('Carla Dias').closest('[data-user-row]') as HTMLElement
    expect(within(carla).queryByText('Vê o trabalho da equipe')).not.toBeInTheDocument()
    const ana = screen.getByText('Ana Souza').closest('[data-user-row]') as HTMLElement
    expect(within(ana).getByText('Admin')).toBeInTheDocument()
    expect(within(ana).getByText('Todos os departamentos')).toBeInTheDocument()
  })

  it('secondary actions live in the row menu; deactivating asks first', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Mais ações de Bruno Lima' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Redefinir senha', 'Transferir responsabilidades', 'Desativar'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Desativar' }))
    expect(confirmMock).toHaveBeenCalled()
    await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', url: '/users/u2' }))
  })

  it('the menu closes with Escape', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Mais ações de Bruno Lima' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('the admin can only be moved (transfer), not edited nor deactivated here', async () => {
    renderPage()
    await screen.findByText('Ana Souza')
    expect(screen.queryByRole('button', { name: 'Editar Ana Souza' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações de Ana Souza' }))
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Transferir responsabilidades'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Transferir responsabilidades' }))
    expect(await screen.findByText('tela de transferência')).toBeInTheDocument()
  })

  it('new person: no password field, profile chosen in cards; the generated password is shown once', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }))
    const panel = screen.getByRole('dialog', { name: 'Novo usuário' })
    expect(within(panel).queryByLabelText(/Senha/)).not.toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText('Nome'), 'Nova Pessoa')
    await userEvent.type(within(panel).getByLabelText('E-mail'), 'nova@x.com')
    await userEvent.click(within(panel).getByRole('radio', { name: /Gerente/ }))
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Fiscal' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() => expect(calls[0]?.body).toMatchObject({ name: 'Nova Pessoa', email: 'nova@x.com', role: 'ORG_MANAGER', departmentIds: ['fiscal'] }))
    expect(calls[0]?.body).not.toHaveProperty('password')
    const done = await screen.findByRole('dialog', { name: 'Usuário cadastrado' })
    expect(within(done).getByText('Tmp-9f2k-ab7Q')).toBeInTheDocument()
  })

  it('editing opens the same panel with the person data', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Carla Dias' }))
    const panel = screen.getByRole('dialog', { name: 'Editar usuário' })
    expect(within(panel).getByLabelText('Nome')).toHaveValue('Carla Dias')
    expect(within(panel).getByRole('radio', { name: /Gerente/ })).toBeChecked()
    expect(within(panel).getByRole('checkbox', { name: 'Legalização' })).toBeChecked()
    await userEvent.click(within(panel).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: 'PATCH', url: '/users/u3' })))
  })

  it('filters by profile and department', async () => {
    renderPage()
    await screen.findByText('Bruno Lima')
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'ORG_MANAGER')
    expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
    expect(screen.getByText('Carla Dias')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'all')
    await userEvent.selectOptions(screen.getByLabelText('Departamento'), 'fiscal')
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.queryByText('Carla Dias')).not.toBeInTheDocument()
  })

  it('deactivated people are listed apart and can be reactivated', async () => {
    renderPage()
    await screen.findByText('Bruno Lima')
    await userEvent.click(screen.getByRole('radio', { name: 'Desativados' }))
    expect(await screen.findByText('Davi Antigo')).toBeInTheDocument()
    expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reativar Davi Antigo' }))
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', url: '/users/u9/reactivate' }))
  })

  it('a search with no result says so and offers to clear it', async () => {
    renderPage()
    await screen.findByText('Bruno Lima')
    await userEvent.type(screen.getByLabelText('Buscar pessoas'), 'zzz')
    expect(screen.getByText('Ninguém encontrado com esses filtros.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
  })

  it('what is being typed survives the list reloading behind the panel', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Carla Dias' }))
    const name = within(screen.getByRole('dialog', { name: 'Editar usuário' })).getByLabelText('Nome')
    await userEvent.clear(name)
    await userEvent.type(name, 'Carla Dias Souza')
    // Coming back to the tab refetches the list (new data, new render of the page)
    const before = listFetches
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await waitFor(() => expect(listFetches).toBeGreaterThan(before))
    await screen.findByText('Eva Nova')
    await new Promise((r) => setTimeout(r, 50))
    expect(name).toHaveValue('Carla Dias Souza')
  })

  it('resetting a password asks first', async () => {
    confirmMock.mockResolvedValueOnce(false)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Mais ações de Bruno Lima' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Redefinir senha' }))
    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Redefinir a senha de Bruno Lima?' }))
    expect(screen.queryByRole('dialog', { name: 'Senha redefinida' })).not.toBeInTheDocument()
  })

  it('the panel cannot be closed while saving, so the new password is never lost', async () => {
    let release: () => void = () => {}
    server.use(http.post(`${API}/users`, async () => {
      await new Promise<void>((r) => { release = r })
      return HttpResponse.json({ id: 'u4', name: 'Nova Pessoa', email: 'nova@x.com', role: 'ORG_MEMBER', isActive: true, temporaryPassword: 'Tmp-late-1234' }, { status: 201 })
    }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }))
    const panel = screen.getByRole('dialog', { name: 'Novo usuário' })
    await userEvent.type(within(panel).getByLabelText('Nome'), 'Nova Pessoa')
    await userEvent.type(within(panel).getByLabelText('E-mail'), 'nova@x.com')
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Fiscal' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Cadastrar' }))
    expect(within(panel).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Novo usuário' })).toBeInTheDocument()
    release()
    expect(await screen.findByText('Tmp-late-1234')).toBeInTheDocument()
  })
})

