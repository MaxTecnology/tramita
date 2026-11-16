import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { DeadlineChip } from './DeadlineChip'

const base = { officeBusinessDays: 1, clientBusinessDays: 0 }

it.each([
  [{ state: 'ON_TIME' as const, businessDaysLeft: 5 }, 'faltam 5 dias úteis'],
  [{ state: 'DUE_SOON' as const, businessDaysLeft: 1 }, 'falta 1 dia útil'],
  [{ state: 'DUE_SOON' as const, businessDaysLeft: 0 }, 'vence hoje'],
  [{ state: 'LATE' as const, businessDaysLate: 2 }, 'atrasada há 2 dias úteis'],
  [{ state: 'PAUSED' as const, pausedSinceDays: 4 }, '⏸ aguardando cliente há 4 dias'],
  [{ state: 'PAUSED' as const, pausedSinceDays: 0 }, '⏸ aguardando cliente desde hoje'],
  [{ state: 'PAUSED' as const }, '⏸ aguardando cliente'],
  [{ state: 'DONE' as const }, 'concluída'],
])('shows %o as "%s"', (deadline, text) => {
  render(<DeadlineChip deadline={{ ...base, ...deadline }} />)
  expect(screen.getByText(text)).toBeInTheDocument()
})

it('waiting for another OS names it when known', () => {
  render(<DeadlineChip deadline={{ ...base, state: 'WAITING_DEPENDENCY' }} waitingFor="Registro na Junta" />)
  expect(screen.getByText('aguardando Registro na Junta')).toBeInTheDocument()
})

it('no deadline shows nothing', () => {
  const { container } = render(<DeadlineChip deadline={{ ...base, state: 'NONE' }} />)
  expect(container).toBeEmptyDOMElement()
})

it('OSTag marks an OS and names its process', async () => {
  const { OSTag } = await import('./DeadlineChip')
  render(<OSTag model="Registro na Junta" process="Abertura ACME" />)
  expect(screen.getByText('OS')).toHaveAttribute('title', 'Ordem de serviço: Registro na Junta')
  expect(screen.getByText('Abertura ACME')).toBeInTheDocument()
})
