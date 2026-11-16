import { describe, it, expect } from 'vitest'
import { nationalHolidays, isBusinessDay, addBusinessDays, businessDaysBetween } from './business-days'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (x: Date) => x.toISOString().slice(0, 10)
const h = new Set([...nationalHolidays(2026), ...nationalHolidays(2027)])

describe('business days', () => {
  it('national holidays of 2026 include Good Friday and Consciência Negra', () => {
    expect(nationalHolidays(2026)).toEqual(expect.arrayContaining([
      '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    ]))
    expect(nationalHolidays(2026)).toHaveLength(10)
  })

  it('weekends and holidays are not business days', () => {
    expect(isBusinessDay(d('2026-11-14'), h)).toBe(false) // saturday
    expect(isBusinessDay(d('2026-11-20'), h)).toBe(false)
    expect(isBusinessDay(d('2026-11-19'), h)).toBe(true)
  })

  it('adds business days skipping weekends, holidays and the year turn', () => {
    expect(iso(addBusinessDays(d('2026-11-13'), 1, h))).toBe('2026-11-16')
    expect(iso(addBusinessDays(d('2026-11-19'), 1, h))).toBe('2026-11-23')
    expect(iso(addBusinessDays(d('2026-12-31'), 1, h))).toBe('2027-01-04')
    expect(iso(addBusinessDays(d('2026-11-13'), 5, h))).toBe('2026-11-23')
    expect(iso(addBusinessDays(d('2026-11-13T15:30:00.000Z'.slice(0, 10)), 0, h))).toBe('2026-11-13')
  })

  it('counts business days in (from, to]', () => {
    expect(businessDaysBetween(d('2026-11-13'), d('2026-11-16'), h)).toBe(1)
    expect(businessDaysBetween(d('2026-11-16'), d('2026-11-16'), h)).toBe(0)
    expect(businessDaysBetween(d('2026-11-16'), d('2026-11-18'), h)).toBe(2)
    expect(businessDaysBetween(d('2026-11-18'), d('2026-11-16'), h)).toBe(0)
    expect(businessDaysBetween(d('2026-11-19'), d('2026-11-23'), h)).toBe(1)
  })

  it('ignores the time of day (dates are compared by UTC day)', () => {
    expect(businessDaysBetween(new Date('2026-11-16T22:00:00Z'), new Date('2026-11-17T01:00:00Z'), h)).toBe(1)
  })
})
