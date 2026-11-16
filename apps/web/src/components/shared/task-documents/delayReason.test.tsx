import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, it, vi } from 'vitest'
import { server } from '@/test/server'
import { AppDialogs } from '@/components/ui/app-dialogs'
import { withDelayReason, type DelayMemory } from './delayReason'

const API = 'http://localhost:3000'
const missing = (message: string) => Object.assign(new Error(message), { response: { status: 422, data: { message } } })

beforeEach(() => {
  server.use(http.get(`${API}/delay-reasons`, () => HttpResponse.json([
    { id: 'r1', name: 'Aguardando órgão público', requiresNote: false, isActive: true, position: 0 },
    { id: 'r4', name: 'Outro', requiresNote: true, isActive: true, position: 1 },
    { id: 'r9', name: 'Antigo', requiresNote: false, isActive: false, position: 2 },
  ])))
  render(<AppDialogs />)
})

it('asks the reason when the API says it is missing and sends it again', async () => {
  const send = vi.fn()
    .mockRejectedValueOnce(missing('Informe o motivo do atraso'))
    .mockResolvedValueOnce('ok')
  const done = withDelayReason(send)
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r1')
  expect(screen.queryByRole('option', { name: 'Antigo' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await expect(done).resolves.toBe('ok')
  expect(send).toHaveBeenLastCalledWith({ delayReasonId: 'r1' })
})

it('"Outro" needs a note, and the process reason is asked after the OS one', async () => {
  const send = vi.fn()
    .mockRejectedValueOnce(missing('Informe o motivo do atraso'))
    .mockRejectedValueOnce(missing('Informe o motivo do atraso do processo'))
    .mockResolvedValueOnce('ok')
  const done = withDelayReason(send)
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r4')
  expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Observação'), 'Cliente mudou o pedido')
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  expect(await screen.findByText(/Motivo do atraso do processo/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Motivo'), 'r1')
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await expect(done).resolves.toBe('ok')
  expect(send).toHaveBeenLastCalledWith({ delayReasonId: 'r4', delayNote: 'Cliente mudou o pedido', processDelayReasonId: 'r1' })
})

it('giving up keeps the task as it was', async () => {
  const send = vi.fn().mockRejectedValueOnce(missing('Informe o motivo do atraso'))
  const done = withDelayReason(send)
  await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
  await expect(done).resolves.toBeNull()
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
})

it('other errors pass through', async () => {
  const send = vi.fn().mockRejectedValueOnce(missing('Esta OS aguarda: A'))
  await expect(withDelayReason(send)).rejects.toThrow('Esta OS aguarda: A')
})

it('in a batch, "use for the next ones" answers the following late OS without asking again', async () => {
  const memory: DelayMemory = {}
  const first = vi.fn().mockRejectedValueOnce(missing('Informe o motivo do atraso')).mockResolvedValueOnce('a')
  const done = withDelayReason(first, memory)
  await userEvent.selectOptions(await screen.findByLabelText('Motivo'), 'r1')
  await userEvent.click(screen.getByLabelText('Usar este motivo nas próximas OS atrasadas'))
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }))
  await expect(done).resolves.toBe('a')

  const second = vi.fn().mockRejectedValueOnce(missing('Informe o motivo do atraso')).mockResolvedValueOnce('b')
  await expect(withDelayReason(second, memory)).resolves.toBe('b')
  expect(second).toHaveBeenLastCalledWith({ delayReasonId: 'r1' })
  expect(screen.queryByLabelText('Motivo')).not.toBeInTheDocument()
})

it('without a batch the option is not offered', async () => {
  const send = vi.fn().mockRejectedValueOnce(missing('Informe o motivo do atraso')).mockResolvedValueOnce('ok')
  const done = withDelayReason(send)
  await screen.findByLabelText('Motivo')
  expect(screen.queryByLabelText('Usar este motivo nas próximas OS atrasadas')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  await done
})
