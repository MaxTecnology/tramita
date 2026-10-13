import { describe, it, expect } from 'vitest'
import { utcDayLabel, todayInBRT, startOfTodayInBRT, startOfMonthInBRT } from './date-only'

describe('utcDayLabel', () => {
  it('lê o rótulo pelos getters UTC, sem reconverter fuso', () => {
    expect(utcDayLabel(new Date('2026-10-20T00:00:00Z'))).toBe(Date.UTC(2026, 9, 20))
  })
})

describe('todayInBRT', () => {
  it('ainda é o dia anterior pouco depois da meia-noite UTC (00:00-03:00 UTC = 21h-00h BRT do dia anterior)', () => {
    expect(todayInBRT(new Date('2026-10-20T01:00:00Z'))).toBe(Date.UTC(2026, 9, 19))
  })

  it('já é o novo dia a partir das 03:00 UTC (meia-noite BRT)', () => {
    expect(todayInBRT(new Date('2026-10-20T03:00:00Z'))).toBe(Date.UTC(2026, 9, 20))
  })
})

describe('startOfTodayInBRT', () => {
  it('devolve o instante UTC correspondente à meia-noite BRT de hoje', () => {
    expect(startOfTodayInBRT(new Date('2026-10-20T11:00:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z')
  })
})

describe('startOfMonthInBRT', () => {
  it('não vira pro próximo mês antes da meia-noite BRT virar (vira só às 03:00 UTC do dia 1)', () => {
    // 2026-11-01T01:00Z = 2026-10-31T22:00 BRT — ainda outubro em BRT.
    expect(startOfMonthInBRT(new Date('2026-11-01T01:00:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('vira pro mês novo a partir de 03:00 UTC do dia 1 (meia-noite BRT)', () => {
    expect(startOfMonthInBRT(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})
