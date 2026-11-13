import { describe, expect, it } from 'vitest'
import { periodRange } from './tasksPeriod'

describe('periodRange', () => {
  const now = new Date(2026, 10, 13, 15, 0) // 13/nov/2026, local time

  it('this month: first to last day', () => {
    expect(periodRange('this', now)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('last month, across the year boundary too', () => {
    expect(periodRange('last', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('last', new Date(2027, 0, 5))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('custom keeps the dates the user typed (open-ended allowed)', () => {
    expect(periodRange('custom', now, { from: '2026-09-15', to: '' })).toEqual({ from: '2026-09-15', to: '' })
  })
})
