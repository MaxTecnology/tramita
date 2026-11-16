import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { RequestAttachments } from './RequestAttachments'

const file = { id: 'a1', filename: 'contrato.pdf', mimeType: 'application/pdf', size: 2048, createdAt: '2026-11-16T12:00:00.000Z', url: 'https://signed.example/contrato' }

function renderIt(props: { canUpload: boolean; attachments?: typeof file[] }) {
  // jsdom's FormData does not survive the trip to msw: the upload is checked through a spy
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { ...file, id: 'a2' } })
  const uploaded = () => {
    const call = post.mock.calls.find(([url]) => url === '/portal/requests/r1/attachments')
    return call ? ((call[1] as FormData).get('file') as File).name : null
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RequestAttachments requestId="r1" attachments={props.attachments ?? [file]} canUpload={props.canUpload} />
    </QueryClientProvider>,
  )
  return { uploaded }
}

it('lists each file with its download link and size', () => {
  renderIt({ canUpload: false })
  expect(screen.getByRole('link', { name: /contrato\.pdf/ })).toHaveAttribute('href', 'https://signed.example/contrato')
  expect(screen.getByText('2 KB')).toBeInTheDocument()
  expect(screen.queryByText('Anexar arquivo')).not.toBeInTheDocument()
})

it('the client attaches a file while the request is open', async () => {
  const { uploaded } = renderIt({ canUpload: true })
  await userEvent.upload(screen.getByLabelText('Anexar arquivo'), new File(['x'], 'rg.pdf', { type: 'application/pdf' }))
  await waitFor(() => expect(uploaded()).toBe('rg.pdf'))
})

it('shows nothing for a closed request without files', () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}><RequestAttachments requestId="r1" attachments={[]} canUpload={false} /></QueryClientProvider>,
  )
  expect(container).toBeEmptyDOMElement()
})
