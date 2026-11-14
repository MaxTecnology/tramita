import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AppDialogs, askConfirm, askText } from './app-dialogs'

it('asks for a reason inside the app; confirm only with text; resolves with it', async () => {
  render(<AppDialogs />)
  let answer: Promise<string | null> = Promise.resolve(null)
  act(() => { answer = askText({ title: 'Rejeitar documento', label: 'Motivo da rejeição', confirmLabel: 'Rejeitar', danger: true }) })
  const confirm = await screen.findByRole('button', { name: 'Rejeitar' })
  expect(confirm).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Motivo da rejeição'), '  Ilegível  ')
  await userEvent.click(confirm)
  await expect(answer).resolves.toBe('Ilegível')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('Cancelar resolves null; a yes/no question resolves true or false', async () => {
  render(<AppDialogs />)
  let text: Promise<string | null> = Promise.resolve('x')
  act(() => { text = askText({ title: 'Nome', label: 'Nome do documento' }) })
  await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
  await expect(text).resolves.toBeNull()

  let yes: Promise<boolean> = Promise.resolve(false)
  act(() => { yes = askConfirm({ title: 'Desativar o usuário "Carla"?', confirmLabel: 'Desativar', danger: true }) })
  await userEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
  await expect(yes).resolves.toBe(true)
})
