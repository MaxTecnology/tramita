import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TemplateEditor } from '@/components/TemplateEditor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const VARS = ['clientName', 'orgName', 'portalUrl', 'taskTitle', 'fromColumn', 'toColumn']
const confirmMock = vi.fn()
vi.mock('@/components/ui/app-dialogs', () => ({ askConfirm: (o: unknown) => confirmMock(o) }))

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('renders preview in real time when clicking preview button', async () => {
  server.use(
    http.get('http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Olá, {{clientName}}!', isDefault: true, variables: VARS }),
    ),
    http.post(
      'http://localhost:3000/notifications/templates/preview',
      async ({ request }) => {
        const body = await request.json() as { body: string }
        return HttpResponse.json({
          rendered: body.body.replace('{{clientName}}', 'João Silva'),
        })
      },
    ),
  )

  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })

  // Wait for template to load
  await waitFor(() => screen.getByDisplayValue('Olá, {{clientName}}!'))

  await userEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))

  await waitFor(() => {
    expect(screen.getByText(/João Silva/)).toBeInTheDocument()
  })
})

it('shows save button and submits PUT on click', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Template atual', isDefault: false, variables: VARS }),
    ),
    http.put(
      'http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP',
      async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ body: 'Template atual', event: 'TASK_MOVED', channel: 'WHATSAPP' })
      },
    ),
  )

  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })

  await waitFor(() => screen.getByDisplayValue('Template atual'))
  await userEvent.click(screen.getByRole('button', { name: 'Salvar mensagem' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ body: 'Template atual' })
  })
})

const URL = 'http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP'

it('a variable is inserted where the cursor is, by its name in plain words', async () => {
  server.use(http.get(URL, () => HttpResponse.json({ body: 'Olá, ! Tudo certo.', isDefault: true, variables: VARS })))
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })
  const box = await screen.findByDisplayValue('Olá, ! Tudo certo.') as HTMLTextAreaElement
  box.focus()
  box.setSelectionRange(5, 5)
  fireEvent.select(box)
  await userEvent.click(screen.getByRole('button', { name: 'Nome do cliente' }))
  expect(box.value).toBe('Olá, {{clientName}}! Tudo certo.')
})

it('says whether the text is the system default or the office own, and can go back to the default', async () => {
  confirmMock.mockReset().mockResolvedValue(true)
  let deleted = false
  server.use(
    http.get(URL, () => HttpResponse.json({ body: 'Texto do escritório', isDefault: false, variables: VARS })),
    http.delete(URL, () => { deleted = true; return HttpResponse.json({}) }),
  )
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })
  expect(await screen.findByText('Personalizada pelo escritório')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Voltar ao texto padrão' }))
  expect(confirmMock).toHaveBeenCalled()
  await waitFor(() => expect(deleted).toBe(true))
})

it('the system default has no "back to default" button', async () => {
  server.use(http.get(URL, () => HttpResponse.json({ body: 'Padrão', isDefault: true, variables: VARS })))
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })
  expect(await screen.findByText('Texto padrão do sistema')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Voltar ao texto padrão' })).not.toBeInTheDocument()
})


it('only offers the fields this notice fills', async () => {
  server.use(http.get(URL, () => HttpResponse.json({ body: 'Oi', isDefault: true, variables: ['clientName', 'taskTitle', 'portalUrl'] })))
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })
  expect(await screen.findByRole('button', { name: 'Nome do cliente' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Link do portal' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Etapa anterior' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Lista de tarefas em alerta' })).not.toBeInTheDocument()
})

it('warns when the text uses a field this notice leaves empty', async () => {
  server.use(http.get(URL, () => HttpResponse.json({ body: 'Oi {{clientName}}, {{fromColumn}} {{inventado}}', isDefault: false, variables: ['clientName', 'portalUrl'] })))
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })
  const warning = await screen.findByRole('status', { name: 'Campos que saem vazios' })
  expect(warning).toHaveTextContent('Etapa anterior')
  expect(warning).toHaveTextContent('{{inventado}}')
  expect(warning).not.toHaveTextContent('Nome do cliente')
})

it('tells the page when the text has unsaved changes', async () => {
  const onDirtyChange = vi.fn()
  server.use(http.get(URL, () => HttpResponse.json({ body: 'Oi', isDefault: true, variables: VARS })))
  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" onDirtyChange={onDirtyChange} />, { wrapper })
  const box = await screen.findByDisplayValue('Oi')
  await userEvent.type(box, '!')
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await userEvent.type(box, '{backspace}')
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
})
