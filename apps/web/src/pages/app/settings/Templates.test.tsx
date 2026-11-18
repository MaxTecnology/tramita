import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import Templates from './Templates'

const API = 'http://localhost:3000'
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))
beforeEach(() => { confirmMock.mockReset() })
const VARS = ['clientName', 'portalUrl', 'taskTitle']
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Templates /></MemoryRouter></QueryClientProvider>)

it('switching notice never lets the previous text be saved into the new one', async () => {
  const saved: { url: string; body: unknown }[] = []
  server.use(
    http.get(`${API}/notifications/templates/TASK_MOVED/WHATSAPP`, () => HttpResponse.json({ body: 'Texto da tarefa movida', isDefault: false, variables: VARS })),
    http.get(`${API}/notifications/templates/TASK_CREATED/WHATSAPP`, async () => { await delay(300); return HttpResponse.json({ body: 'Texto da tarefa criada', isDefault: true, variables: VARS }) }),
    http.put(`${API}/notifications/templates/:event/:channel`, async ({ request }) => { saved.push({ url: request.url, body: await request.json() }); return HttpResponse.json({}) }),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Templates /></MemoryRouter></QueryClientProvider>)
  await screen.findByDisplayValue('Texto da tarefa movida')
  await userEvent.selectOptions(screen.getByLabelText('Aviso'), 'TASK_CREATED')
  // While the new notice loads: the old text is gone and saving is not possible
  expect(screen.queryByDisplayValue('Texto da tarefa movida')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Salvar mensagem' })).toBeDisabled()
  expect(await screen.findByDisplayValue('Texto da tarefa criada')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar mensagem' })).toBeEnabled())
  expect(saved).toEqual([])
})

function serveTwoNotices() {
  server.use(
    http.get(`${API}/notifications/templates/TASK_MOVED/:channel`, () => HttpResponse.json({ body: 'Texto da tarefa movida', isDefault: false, variables: VARS })),
    http.get(`${API}/notifications/templates/TASK_CREATED/:channel`, () => HttpResponse.json({ body: 'Texto da tarefa criada', isDefault: true, variables: VARS })),
  )
}

it('switching notice with unsaved text asks first; saying no keeps the text and the notice', async () => {
  serveTwoNotices()
  confirmMock.mockResolvedValue(false)
  renderPage()
  const box = await screen.findByDisplayValue('Texto da tarefa movida')
  await userEvent.type(box, ' editado')
  await userEvent.selectOptions(screen.getByLabelText('Aviso'), 'TASK_CREATED')
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Descartar a mudança não salva?' }))
  expect(screen.getByLabelText('Aviso')).toHaveValue('TASK_MOVED')
  expect(screen.getByDisplayValue('Texto da tarefa movida editado')).toBeInTheDocument()
  // the channel too
  await userEvent.selectOptions(screen.getByLabelText('Canal'), 'EMAIL')
  expect(screen.getByLabelText('Canal')).toHaveValue('WHATSAPP')
})

it('saying yes discards and opens the other notice; without edits it never asks', async () => {
  serveTwoNotices()
  confirmMock.mockResolvedValue(true)
  renderPage()
  const box = await screen.findByDisplayValue('Texto da tarefa movida')
  await userEvent.type(box, ' editado')
  await userEvent.selectOptions(screen.getByLabelText('Aviso'), 'TASK_CREATED')
  expect(await screen.findByDisplayValue('Texto da tarefa criada')).toBeInTheDocument()
  confirmMock.mockClear()
  await userEvent.selectOptions(screen.getByLabelText('Aviso'), 'TASK_MOVED')
  expect(await screen.findByDisplayValue('Texto da tarefa movida')).toBeInTheDocument()
  expect(confirmMock).not.toHaveBeenCalled()
})
