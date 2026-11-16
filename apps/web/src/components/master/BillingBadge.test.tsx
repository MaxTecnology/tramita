import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BillingBadge } from './BillingBadge'

const now = new Date('2026-11-16T15:00:00.000Z')

it('an Asaas office just says Asaas', () => {
  render(<BillingBadge billingMode="ASAAS" manualNextDueDate={null} now={now} />)
  expect(screen.getByText('Asaas')).toBeInTheDocument()
})

it('a direct agreement shows its next due date', () => {
  render(<BillingBadge billingMode="MANUAL" manualNextDueDate="2026-12-10T00:00:00.000Z" now={now} />)
  expect(screen.getByText('Acerto direto')).toBeInTheDocument()
  expect(screen.getByText('vence 10/12/2026')).toBeInTheDocument()
})

it('warns when the agreement is due within 5 days', () => {
  render(<BillingBadge billingMode="MANUAL" manualNextDueDate="2026-11-19T00:00:00.000Z" now={now} />)
  expect(screen.getByText('vence em 3 dias')).toBeInTheDocument()
})

it('says it is overdue, and today is today', () => {
  const { rerender } = render(<BillingBadge billingMode="MANUAL" manualNextDueDate="2026-11-10T00:00:00.000Z" now={now} />)
  expect(screen.getByText('vencido em 10/11/2026')).toBeInTheDocument()
  rerender(<BillingBadge billingMode="MANUAL" manualNextDueDate="2026-11-16T00:00:00.000Z" now={now} />)
  expect(screen.getByText('vence hoje')).toBeInTheDocument()
})

it('a direct agreement with no due date asks for one', () => {
  render(<BillingBadge billingMode="MANUAL" manualNextDueDate={null} now={now} />)
  expect(screen.getByText('sem vencimento')).toBeInTheDocument()
})
