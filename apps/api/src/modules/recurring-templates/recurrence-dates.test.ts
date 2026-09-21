import { describe, it, expect } from 'vitest'
import {
  computeDueDate,
  computeTargetDate,
  computeCompetencesToGenerate,
  computeCurrentPeriodStart,
  normalizeToPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'

const monthlyRules: RecurrenceDateRules = {
  periodicity: 'MONTHLY',
  dueMonthOffset: 1,
  dueDayOfPeriod: 15,
  dueRollToBusinessDay: false,
  targetOffsetDays: -2,
  targetRollToBusinessDay: false,
  generationMonthOffset: 1,
  generationDayOfPeriod: 20,
}

describe('computeDueDate', () => {
  it('mensal: competência fevereiro, vence dia 15 de março (dueMonthOffset=1)', () => {
    const competence = new Date(Date.UTC(2026, 1, 1)) // 2026-02-01
    const due = computeDueDate(competence, monthlyRules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('trimestral: competência Q1 (jan), vence dia 10 do 3º mês do trimestre (março)', () => {
    const rules: RecurrenceDateRules = {
      ...monthlyRules,
      periodicity: 'QUARTERLY',
      dueMonthOffset: 2,
      dueDayOfPeriod: 10,
    }
    const competence = new Date(Date.UTC(2026, 0, 1)) // 2026-01-01
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-10')
  })

  it('anual: competência jan/2027, vence dia 31 do 3º mês depois (março/2027)', () => {
    const rules: RecurrenceDateRules = {
      ...monthlyRules,
      periodicity: 'ANNUAL',
      dueMonthOffset: 2,
      dueDayOfPeriod: 31,
    }
    const competence = new Date(Date.UTC(2027, 0, 1))
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2027-03-31')
  })

  it('semanal: competência é a segunda-feira da semana; dueDayOfPeriod=5 (sexta) cai na mesma semana', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 5 }
    const competence = new Date(Date.UTC(2026, 1, 2)) // segunda-feira 2026-02-02
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-06') // sexta da mesma semana
  })

  it('ajusta pro próximo dia útil quando dueRollToBusinessDay=true e a data cai num sábado', () => {
    // competência fevereiro + dueMonthOffset=1 (herdado de monthlyRules) = base março; dia 14 de março de 2026 é um sábado
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 14, dueRollToBusinessDay: true }
    const competence = new Date(Date.UTC(2026, 1, 1))
    const due = computeDueDate(competence, rules)
    expect(due.getUTCDay()).not.toBe(0)
    expect(due.getUTCDay()).not.toBe(6)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-16') // segunda seguinte
  })

  it('ajusta o dia pro último dia do mês quando dueDayOfPeriod excede os dias do mês de destino', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueMonthOffset: 0, dueDayOfPeriod: 31 }
    const competence = new Date(Date.UTC(2026, 3, 1)) // abril, tem 30 dias
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-04-30')
  })
})

describe('computeTargetDate', () => {
  it('meta = vencimento + targetOffsetDays (negativo = antes)', () => {
    const due = new Date(Date.UTC(2026, 2, 15)) // 2026-03-15
    const target = computeTargetDate(due, monthlyRules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-13')
  })

  it('ajusta a meta pro próximo dia útil independente do ajuste do vencimento', () => {
    // due=2026-03-16 (segunda) + targetOffsetDays=-1 = 2026-03-15 (domingo) — cai em fim de semana
    const rules: RecurrenceDateRules = { ...monthlyRules, targetOffsetDays: -1, targetRollToBusinessDay: true }
    const due = new Date(Date.UTC(2026, 2, 16)) // segunda 2026-03-16 -> meta cai em 2026-03-15 (domingo)
    const target = computeTargetDate(due, rules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-16') // empurra pra segunda
  })
})

describe('computeCompetencesToGenerate', () => {
  it('mensal: dispara só no dia configurado, gera 1 competência (mês seguinte)', () => {
    const trigger = new Date(Date.UTC(2026, 0, 20)) // 20 de janeiro
    const notTrigger = new Date(Date.UTC(2026, 0, 19))
    expect(computeCompetencesToGenerate(trigger, monthlyRules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01'])
    expect(computeCompetencesToGenerate(notTrigger, monthlyRules)).toEqual([])
  })

  it('trimestral: só gera quando o mês seguinte inicia um trimestre novo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY' }
    const triggersNewQuarter = new Date(Date.UTC(2025, 11, 20)) // dezembro -> gera Q1 (janeiro)
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20)) // janeiro -> mês seguinte é fevereiro, não é início de trimestre
    expect(computeCompetencesToGenerate(triggersNewQuarter, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-01-01'])
    expect(computeCompetencesToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('anual: só gera quando o mês seguinte é janeiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL' }
    const triggersNewYear = new Date(Date.UTC(2026, 11, 20)) // dezembro -> gera ano seguinte
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20))
    expect(computeCompetencesToGenerate(triggersNewYear, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2027-01-01'])
    expect(computeCompetencesToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('semanal: gera uma competência por cada dueDayOfPeriod que cai no mês seguinte inteiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 1 } // segundas-feiras
    const trigger = new Date(Date.UTC(2026, 0, 20)) // gera pro mês de fevereiro/2026
    const mondaysOfFebruary2026 = computeCompetencesToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10))
    expect(mondaysOfFebruary2026).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'])
  })
})

describe('computeCurrentPeriodStart', () => {
  it('mensal: início do mês corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 17)) // 17 de março
    expect(computeCurrentPeriodStart(today, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('semanal: segunda-feira da semana corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira 2026-03-18
    expect(computeCurrentPeriodStart(today, 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('trimestral: início do trimestre corrente', () => {
    const today = new Date(Date.UTC(2026, 4, 10)) // maio -> Q2 começa em abril
    expect(computeCurrentPeriodStart(today, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-04-01')
  })

  it('anual: início do ano corrente', () => {
    const today = new Date(Date.UTC(2026, 7, 1))
    expect(computeCurrentPeriodStart(today, 'ANNUAL').toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})

describe('normalizeToPeriodStart', () => {
  it('mensal: canonicaliza um instante qualquer do mês pro dia 1 do mesmo mês', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 17, 13, 22, 0)) // 2026-09-17T13:22:00Z
    expect(normalizeToPeriodStart(arbitrary, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('semanal: canonicaliza um instante qualquer da semana pra segunda-feira daquela semana', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 18, 23, 59, 0)) // sexta-feira 2026-09-18
    expect(normalizeToPeriodStart(arbitrary, 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-09-14')
  })

  it('trimestral: canonicaliza um instante qualquer do trimestre pro início do trimestre', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 30, 5, 0, 0)) // setembro -> Q3 começa em julho
    expect(normalizeToPeriodStart(arbitrary, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('anual: canonicaliza um instante qualquer do ano pro dia 1º de janeiro', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 17, 13, 22, 0))
    expect(normalizeToPeriodStart(arbitrary, 'ANNUAL').toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})
