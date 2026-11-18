import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { server } from '@/test/server'
import Templates from './Templates'

const API = 'http://localhost:3000'

it('switching notice never lets the previous text be saved into the new one', async () => {
  const saved: { url: string; body: unknown }[] = []
  server.use(
    http.get(`${API}/notifications/templates/TASK_MOVED/WHATSAPP`, () => HttpResponse.json({ body: 'Texto da tarefa movida', isDefault: false })),
    http.get(`${API}/notifications/templates/TASK_CREATED/WHATSAPP`, async () => { await delay(300); return HttpResponse.json({ body: 'Texto da tarefa criada', isDefault: true }) }),
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
