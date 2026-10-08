import { describe, it, expect } from 'vitest'
import {
  computeDueDate,
  computeDueDateFromMonth,
  computeCompetenceFromDueMonth,
  computeDueMonthFromCompetence,
  computeTargetDate,
  computeCompetencesToGenerate,
  computeDueMonthsToGenerate,
  computeWeeklyCompetencesInMonth,
  computeCurrentPeriodStart,
  normalizeToPeriodStart,
  computeNextDueMonth,
  type RecurrenceDateRules,
} from './recurrence-dates'

const monthlyRules: RecurrenceDateRules = {
  periodicity: 'MONTHLY',
  competenceMonthOffset: 1,
  dueDayOfPeriod: 15,
  dueMonthAnchor: 1,
  dueBusinessDayRoll: 'NONE',
  targetOffsetDays: -2,
  targetBusinessDayRoll: 'NONE',
  generationMonthOffset: 1,
  generationDayOfPeriod: 20,
}

describe('computeDueDateFromMonth', () => {
  it('mensal: mês de vencimento março, dia 15', () => {
    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const due = computeDueDateFromMonth(dueMonth, monthlyRules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('trimestral: mês de vencimento março, dia 10', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueDayOfPeriod: 10 }
    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-10')
  })

  it('ajusta pro próximo dia útil quando dueBusinessDayRoll=FORWARD e a data cai num sábado', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 14, dueBusinessDayRoll: 'FORWARD' }
    const dueMonth = new Date(Date.UTC(2026, 2, 1)) // 14 de março de 2026 é sábado
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.getUTCDay()).not.toBe(0)
    expect(due.getUTCDay()).not.toBe(6)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('antecipa pro dia útil anterior quando dueBusinessDayRoll=BACKWARD e a data cai num domingo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 20, dueBusinessDayRoll: 'BACKWARD' }
    const dueMonth = new Date(Date.UTC(2026, 8, 1)) // setembro/2026 — dia 20 é domingo
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-09-18')
  })

  it('ajusta o dia pro último dia do mês quando dueDayOfPeriod excede os dias do mês', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 31 }
    const dueMonth = new Date(Date.UTC(2026, 3, 1)) // abril, 30 dias
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-04-30')
  })

  it('lança erro se chamada com periodicidade WEEKLY', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    expect(() => computeDueDateFromMonth(new Date(Date.UTC(2026, 2, 1)), rules)).toThrow()
  })
})

describe('computeCompetenceFromDueMonth', () => {
  it('competência = mês de vencimento - competenceMonthOffset', () => {
    const dueMonth = new Date(Date.UTC(2026, 9, 1)) // outubro
    const competence = computeCompetenceFromDueMonth(dueMonth, { ...monthlyRules, competenceMonthOffset: 1 })
    expect(competence.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('competenceMonthOffset=0: competência igual ao mês de vencimento', () => {
    const dueMonth = new Date(Date.UTC(2026, 9, 1))
    const competence = computeCompetenceFromDueMonth(dueMonth, { ...monthlyRules, competenceMonthOffset: 0 })
    expect(competence.toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  it('lança erro se chamada com periodicidade WEEKLY', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    expect(() => computeCompetenceFromDueMonth(new Date(Date.UTC(2026, 9, 1)), rules)).toThrow()
  })
})

describe('computeDueMonthFromCompetence', () => {
  it('inverte computeCompetenceFromDueMonth: competência + competenceMonthOffset meses = mês de vencimento', () => {
    const competence = new Date(Date.UTC(2026, 8, 1)) // setembro
    const dueMonth = computeDueMonthFromCompetence(competence, { ...monthlyRules, competenceMonthOffset: 1 })
    expect(dueMonth.toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  it('WEEKLY: dueMonth é a própria competência', () => {
    const competence = new Date(Date.UTC(2026, 1, 2)) // segunda-feira
    const dueMonth = computeDueMonthFromCompetence(competence, { periodicity: 'WEEKLY', competenceMonthOffset: 1 })
    expect(dueMonth.toISOString().slice(0, 10)).toBe('2026-02-02')
  })
})

describe('computeWeeklyCompetencesInMonth', () => {
  it('retorna todas as segundas-feiras do mês calendário de outubro/2026', () => {
    const monthDate = new Date(Date.UTC(2026, 9, 15)) // outubro
    const mondays = computeWeeklyCompetencesInMonth(monthDate).map((d) => d.toISOString().slice(0, 10))
    expect(mondays).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  })
})

describe('computeTargetDate', () => {
  it('meta = vencimento + targetOffsetDays (negativo = antes)', () => {
    const due = new Date(Date.UTC(2026, 2, 15))
    const target = computeTargetDate(due, monthlyRules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-13')
  })

  it('ajusta a meta pro próximo dia útil independente do ajuste do vencimento', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, targetOffsetDays: -1, targetBusinessDayRoll: 'FORWARD' }
    const due = new Date(Date.UTC(2026, 2, 16)) // segunda -> meta cai domingo 15
    const target = computeTargetDate(due, rules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-16')
  })
})

describe('computeDueMonthsToGenerate', () => {
  it('mensal: dispara só no dia configurado, gera 1 mês de vencimento (gatilho + generationMonthOffset)', () => {
    const trigger = new Date(Date.UTC(2026, 0, 20))
    const notTrigger = new Date(Date.UTC(2026, 0, 19))
    expect(computeDueMonthsToGenerate(trigger, monthlyRules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01'])
    expect(computeDueMonthsToGenerate(notTrigger, monthlyRules)).toEqual([])
  })

  it('generationMonthOffset=0 gera o mês de vencimento no próprio mês do gatilho', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, generationMonthOffset: 0 }
    const trigger = new Date(Date.UTC(2026, 8, 20))
    expect(computeDueMonthsToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-09-01'])
  })

  it('trimestral: só gera quando o mês de vencimento calculado inicia um trimestre novo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY' }
    const triggersNewQuarter = new Date(Date.UTC(2025, 11, 20)) // dezembro -> +1 mês = janeiro (Q1)
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20)) // janeiro -> +1 mês = fevereiro
    expect(computeDueMonthsToGenerate(triggersNewQuarter, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-01-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('anual: só gera quando o mês de vencimento calculado é janeiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL' }
    const triggersNewYear = new Date(Date.UTC(2026, 11, 20))
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20))
    expect(computeDueMonthsToGenerate(triggersNewYear, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2027-01-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('lança erro se chamada com periodicidade WEEKLY', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    expect(() => computeDueMonthsToGenerate(new Date(Date.UTC(2026, 0, 20)), rules)).toThrow()
  })

  it('trimestral: dueMonthAnchor=2 gera no grupo Fev/Mai/Ago/Nov, não no grupo padrão Jan/Abr/Jul/Out', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueMonthAnchor: 2, generationMonthOffset: 1 }
    const triggersFebGroup = new Date(Date.UTC(2026, 0, 20)) // janeiro -> +1 mês = fevereiro (grupo 2)
    const doesNotTrigger = new Date(Date.UTC(2026, 1, 20)) // fevereiro -> +1 mês = março (grupo 3, não o 2)
    expect(computeDueMonthsToGenerate(triggersFebGroup, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('trimestral: dueMonthAnchor=3 gera no grupo Mar/Jun/Set/Dez', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueMonthAnchor: 3, generationMonthOffset: 1 }
    const triggersMarGroup = new Date(Date.UTC(2026, 1, 20)) // fevereiro -> +1 mês = março (grupo 3)
    expect(computeDueMonthsToGenerate(triggersMarGroup, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-03-01'])
  })

  it('anual: dueMonthAnchor=3 (DEFIS em março) gera só quando o mês de vencimento calculado é março', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL', dueMonthAnchor: 3, generationMonthOffset: 1 }
    const triggersMarch = new Date(Date.UTC(2026, 1, 20)) // fevereiro -> +1 mês = março
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20)) // janeiro -> +1 mês = fevereiro
    expect(computeDueMonthsToGenerate(triggersMarch, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-03-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('regressão do bug original: DAS com generationDayOfPeriod=20, generationMonthOffset=1, dueDayOfPeriod=10, competenceMonthOffset=1 — dispara 20/set, vence 10/out, competência setembro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 10, generationDayOfPeriod: 20, generationMonthOffset: 1, competenceMonthOffset: 1 }
    const trigger = new Date(Date.UTC(2026, 8, 20))
    const [dueMonth] = computeDueMonthsToGenerate(trigger, rules)
    expect(dueMonth.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(computeDueDateFromMonth(dueMonth, rules).toISOString().slice(0, 10)).toBe('2026-10-10')
    expect(computeCompetenceFromDueMonth(dueMonth, rules).toISOString().slice(0, 10)).toBe('2026-09-01')
  })
})

describe('computeDueDate (só WEEKLY)', () => {
  it('semanal: competência é a segunda-feira da semana; dueDayOfPeriod=5 (sexta) cai na mesma semana', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 5 }
    const competence = new Date(Date.UTC(2026, 1, 2)) // segunda-feira
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-06')
  })
})

describe('computeCompetencesToGenerate (só WEEKLY)', () => {
  it('gera uma competência por cada dueDayOfPeriod que cai no mês seguinte inteiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 1 }
    const trigger = new Date(Date.UTC(2026, 0, 20))
    const mondaysOfFebruary2026 = computeCompetencesToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10))
    expect(mondaysOfFebruary2026).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'])
  })

  it('lança erro se chamada com periodicidade não-WEEKLY', () => {
    expect(() => computeCompetencesToGenerate(new Date(Date.UTC(2026, 0, 20)), monthlyRules)).toThrow()
  })
})

describe('computeCurrentPeriodStart', () => {
  it('mensal: início do mês corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 17))
    expect(computeCurrentPeriodStart(today, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('semanal: segunda-feira da semana corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira
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
    const arbitrary = new Date(Date.UTC(2026, 8, 17, 13, 22, 0))
    expect(normalizeToPeriodStart(arbitrary, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('semanal: canonicaliza um instante qualquer da semana pra segunda-feira daquela semana', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 18, 23, 59, 0)) // sexta-feira
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

describe('computeNextDueMonth', () => {
  it('mensal: mesmo cálculo que o cron faria se disparasse hoje (gatilho + generationMonthOffset)', () => {
    const today = new Date(Date.UTC(2026, 8, 15)) // qualquer dia de setembro, não precisa ser o dia de gatilho
    expect(computeNextDueMonth(today, monthlyRules).toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  it('semanal: usa computeCurrentPeriodStart (semana corrente), ignora generationMonthOffset', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira
    expect(computeNextDueMonth(today, rules).toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('trimestral: candidato mínimo já bate com dueMonthAnchor — devolve direto, sem avançar', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueMonthAnchor: 1, generationMonthOffset: 1 }
    const today = new Date(Date.UTC(2025, 11, 15)) // dezembro -> +1 mês = janeiro, já é grupo 1 (Jan/Abr/Jul/Out)
    expect(computeNextDueMonth(today, rules).toISOString().slice(0, 10)).toBe('2026-01-01')
  })

  it('trimestral: candidato mínimo não bate com dueMonthAnchor — avança até o próximo mês do grupo, nunca retrocede', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueMonthAnchor: 2, generationMonthOffset: 1 }
    const today = new Date(Date.UTC(2025, 11, 15)) // dezembro -> +1 mês = janeiro, mas o grupo 2 é Fev/Mai/Ago/Nov
    expect(computeNextDueMonth(today, rules).toISOString().slice(0, 10)).toBe('2026-02-01')
  })

  it('anual: candidato mínimo não bate com dueMonthAnchor (DEFIS em março) — avança até março, nunca pula pro ano seguinte sem necessidade', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL', dueMonthAnchor: 3, generationMonthOffset: 1 }
    const today = new Date(Date.UTC(2026, 0, 15)) // janeiro -> +1 mês = fevereiro, âncora é março
    expect(computeNextDueMonth(today, rules).toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('resultado de computeNextDueMonth pra QUARTERLY/ANNUAL sempre bate com o que computeDueMonthsToGenerate aceitaria naquele mês (paridade cron vs manual)', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL', dueMonthAnchor: 3, generationMonthOffset: 1 }
    const today = new Date(Date.UTC(2026, 0, 15))
    const nextDueMonth = computeNextDueMonth(today, rules)
    // Simula o cron disparando exatamente no mês de gatilho que produziria esse dueMonth
    const triggerMonth = addMonthsUTCForTest(nextDueMonth, -rules.generationMonthOffset)
    const trigger = new Date(Date.UTC(triggerMonth.getUTCFullYear(), triggerMonth.getUTCMonth(), rules.generationDayOfPeriod))
    expect(computeDueMonthsToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual([nextDueMonth.toISOString().slice(0, 10)])
  })
})

function addMonthsUTCForTest(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}
