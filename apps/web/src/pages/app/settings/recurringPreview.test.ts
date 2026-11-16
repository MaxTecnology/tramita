import { describe, expect, it } from 'vitest'
import { nextOccurrences, describeRule, type PreviewRules } from './recurringPreview'

const base: PreviewRules = {
  periodicity: 'MONTHLY', dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1,
  competenceMonthOffset: 1, targetOffsetDays: -2, targetBusinessDayRoll: 'NONE',
  generationMonthOffset: 1, generationDayOfPeriod: 20,
}
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const iso = (x: Date) => x.toISOString().slice(0, 10)

describe('próximas gerações', () => {
  it('monthly: created on day 20, due next month, competence the month before the due date', () => {
    const occ = nextOccurrences(base, d('2026-11-15'), 3)
    expect(occ.map((o) => [iso(o.createdOn), iso(o.target), iso(o.due), iso(o.competence)])).toEqual([
      ['2026-11-20', '2026-12-08', '2026-12-10', '2026-11-01'],
      ['2026-12-20', '2027-01-08', '2027-01-10', '2026-12-01'],
      ['2027-01-20', '2027-02-08', '2027-02-10', '2027-01-01'],
    ])
  })

  it('after the generation day of this month, the next one is next month', () => {
    expect(iso(nextOccurrences(base, d('2026-11-21'), 1)[0].createdOn)).toBe('2026-12-20')
  })

  it('due date on a weekend moves to the next business day when asked', () => {
    // 10/01/2027 is a Sunday
    const occ = nextOccurrences({ ...base, dueBusinessDayRoll: 'FORWARD' }, d('2026-12-01'), 1)
    expect(iso(occ[0].due)).toBe('2027-01-11')
  })

  it('quarterly only generates in the anchor months', () => {
    const occ = nextOccurrences({ ...base, periodicity: 'QUARTERLY', dueMonthAnchor: 1 }, d('2026-11-15'), 2)
    expect(occ.map((o) => iso(o.due))).toEqual(['2027-01-10', '2027-04-10'])
  })

  it('weekly has no monthly preview', () => {
    expect(nextOccurrences({ ...base, periodicity: 'WEEKLY' }, d('2026-11-15'), 3)).toEqual([])
  })
})

describe('frase-resumo da regra', () => {
  it('explains the rule in plain Portuguese', () => {
    expect(describeRule({ ...base, dueBusinessDayRoll: 'FORWARD' })).toBe(
      'Todo mês, vence no dia 10 (adiado para o próximo dia útil se cair no fim de semana), referente ao mês anterior. Meta interna: 2 dias antes do vencimento. A tarefa é criada no dia 20 do mês anterior ao vencimento.',
    )
  })

  it('quarterly and annual name the months', () => {
    expect(describeRule({ ...base, periodicity: 'QUARTERLY', competenceMonthOffset: 0, targetOffsetDays: 0, generationMonthOffset: 0, generationDayOfPeriod: 1 })).toBe(
      'A cada trimestre (jan, abr, jul, out), vence no dia 10, referente ao mesmo mês. Meta interna: no dia do vencimento. A tarefa é criada no dia 1 do mesmo mês do vencimento.',
    )
    expect(describeRule({ ...base, periodicity: 'ANNUAL', dueMonthAnchor: 5, dueDayOfPeriod: 31, competenceMonthOffset: 3 })).toMatch(/^Todo ano em maio, vence no dia 31, referente a 3 meses antes\./)
  })
})

describe('nextOccurrences com feriados', () => {
  it('rolls the due date past a holiday when the office calendar is given', () => {
    const rules = { periodicity: 'MONTHLY' as const, dueDayOfPeriod: 20, dueBusinessDayRoll: 'FORWARD' as const, dueMonthAnchor: 1, competenceMonthOffset: 1, targetOffsetDays: 0, targetBusinessDayRoll: 'NONE' as const, generationMonthOffset: 0, generationDayOfPeriod: 1 }
    const [first] = nextOccurrences(rules, new Date(Date.UTC(2026, 10, 1)), 1, new Set(['2026-11-20']))
    expect(first.due.toISOString().slice(0, 10)).toBe('2026-11-23')
    expect(nextOccurrences(rules, new Date(Date.UTC(2026, 10, 1)), 1)[0].due.toISOString().slice(0, 10)).toBe('2026-11-20')
  })
})
