import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TemplateEditor } from '@/components/TemplateEditor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
      HttpResponse.json({ body: 'Olá, {{clientName}}!', isDefault: true }),
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

  await userEvent.click(screen.getByRole('button', { name: 'Prévia' }))

  await waitFor(() => {
    expect(screen.getByText(/João Silva/)).toBeInTheDocument()
  })
})

it('shows save button and submits PUT on click', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Template atual', isDefault: false }),
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
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ body: 'Template atual' })
  })
})
