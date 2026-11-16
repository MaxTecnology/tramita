import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { ProtocolOfficeCard } from './ProtocolOfficeCard'
import type { Protocol } from '@/types'

const protocol: Protocol = {
  id: 'p1', number: '2026-0001', title: 'Guia DAS', content: null, dueDate: '2026-08-20', status: 'SENT', attachmentId: 'a1', taskId: 't1',
  clientId: 'c1', createdAt: '2026-08-10T12:00:00.000Z', deliverableId: 'd1', requiresPayment: true, amount: '100.00', paidAt: null, cancelledAt: null, events: [],
}

beforeEach(() => vi.restoreAllMocks())

async function replaceWith(check: object) {
  const post = vi.spyOn(api, 'post').mockImplementation(async (url: string) =>
    ({ data: url.endsWith('/check') ? check : {} }) as never)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProtocolOfficeCard protocol={protocol} taskId="t1" onReceipt={() => {}} />
      <AppDialogs />
    </QueryClientProvider>,
  )
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  await userEvent.upload(input, new File(['%PDF'], 'nova.pdf', { type: 'application/pdf' }))
  return post
}
const replaces = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.filter(([url]) => String(url).endsWith('/replace'))

it('replacing the file is checked by the robot: a block stops it', async () => {
  const post = await replaceWith({ blocked: 'Este documento é de BETA — não pode ser entregue a ACME', warnings: [], read: {} })
  expect(await screen.findByText('Este documento é de BETA — não pode ser entregue a ACME')).toBeInTheDocument()
  expect(post.mock.calls.some(([url]) => String(url) === '/tasks/t1/documents/deliveries/d1/check')).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Entendi' }))
  expect(replaces(post)).toHaveLength(0)
})

it('warnings accepted: the guide form comes with the amount read in the new file and sends acceptWarnings', async () => {
  const post = await replaceWith({ warnings: ['Competência do documento: 09/2026 — a tarefa é de 08/2026'], read: { amount: '250.00', dueDate: '2026-09-20' } })
  await userEvent.click(await screen.findByRole('button', { name: 'Entregar mesmo assim' }))
  expect(await screen.findByDisplayValue(/250,00/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Substituir por nova.pdf' }))
  await waitFor(() => expect(replaces(post)).toHaveLength(1))
  expect((replaces(post)[0][1] as FormData).get('acceptWarnings')).toBe('true')
})
