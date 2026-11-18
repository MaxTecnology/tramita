import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Departments from './Departments'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

let deleted: string | null = null
beforeEach(() => {
  deleted = null
  confirmMock.mockReset().mockResolvedValue(true)
  server.use(
    http.get(`${API}/departments`, () => HttpResponse.json([
      { id: 'd1', name: 'Fiscal', peopleCount: 3, clientsCount: 42 },
      { id: 'd2', name: 'Pessoal', peopleCount: 1, clientsCount: 0 },
    ])),
    http.delete(`${API}/departments/:id`, ({ params }) => { deleted = String(params.id); return HttpResponse.json({}) }),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Departments /></MemoryRouter></QueryClientProvider>)
})

const row = async (name: string) => (await screen.findByText(name)).closest('[data-list-row]') as HTMLElement

it('each department shows how many people and clients it has', async () => {
  const fiscal = await row('Fiscal')
  expect(within(fiscal).getByText('3 pessoas')).toBeInTheDocument()
  expect(within(fiscal).getByText('42 clientes')).toBeInTheDocument()
  expect(within(await row('Pessoal')).getByText('1 pessoa')).toBeInTheDocument()
})

it('edit opens the form with the name; delete is in the menu and asks first', async () => {
  await userEvent.click(within(await row('Fiscal')).getByRole('button', { name: 'Editar Fiscal' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Fiscal')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(within(await row('Pessoal')).getByRole('button', { name: 'Mais ações de Pessoal' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
  await waitFor(() => expect(deleted).toBe('d2'))
})
