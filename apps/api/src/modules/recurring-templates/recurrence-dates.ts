export type Periodicity = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'

export interface RecurrenceDateRules {
  periodicity: Periodicity
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueRollToBusinessDay: boolean
  targetOffsetDays: number
  targetRollToBusinessDay: boolean
  generationMonthOffset: number
  generationDayOfPeriod: number
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function rollToNextBusinessDay(date: Date): Date {
  const result = new Date(date)
  while (isWeekend(result)) {
    result.setUTCDate(result.getUTCDate() + 1)
  }
  return result
}

function clampDayOfMonth(year: number, monthIndex: number, day: number): number {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, daysInMonth)
}

function addMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/** Segunda-feira da semana ISO em que `date` cai (ou a própria data, se já for segunda). */
function mondayOfWeek(date: Date): Date {
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay() // 1=segunda..7=domingo
  return addDaysUTC(date, 1 - isoDay)
}

export function computeDueDate(competence: Date, rules: RecurrenceDateRules): Date {
  let due: Date
  if (rules.periodicity === 'WEEKLY') {
    // competence é sempre a segunda-feira da semana; dueDayOfPeriod é 1(segunda)-7(domingo)
    due = addDaysUTC(competence, rules.dueDayOfPeriod - 1)
  } else {
    const base = addMonthsUTC(competence, rules.dueMonthOffset)
    const year = base.getUTCFullYear()
    const month = base.getUTCMonth()
    const day = clampDayOfMonth(year, month, rules.dueDayOfPeriod)
    due = new Date(Date.UTC(year, month, day))
  }
  return rules.dueRollToBusinessDay ? rollToNextBusinessDay(due) : due
}

export function computeTargetDate(dueDate: Date, rules: RecurrenceDateRules): Date {
  const target = addDaysUTC(dueDate, rules.targetOffsetDays)
  return rules.targetRollToBusinessDay ? rollToNextBusinessDay(target) : target
}

/**
 * Retorna as competências a gerar hoje, ou [] se hoje não é o dia de gatilho
 * do template (`generationDayOfPeriod`, sempre dia-do-mês, pras 4 periodicidades).
 */
export function computeCompetencesToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const nextMonthStart = addMonthsUTC(startOfMonthUTC(today), 1)

  switch (rules.periodicity) {
    case 'MONTHLY':
      return [nextMonthStart]

    case 'QUARTERLY':
      return nextMonthStart.getUTCMonth() % 3 === 0 ? [nextMonthStart] : []

    case 'ANNUAL':
      return nextMonthStart.getUTCMonth() === 0 ? [nextMonthStart] : []

    case 'WEEKLY': {
      const nextMonthEnd = addMonthsUTC(nextMonthStart, 1)
      const competences: Date[] = []
      let cursor = mondayOfWeek(nextMonthStart)
      if (cursor < nextMonthStart) cursor = addDaysUTC(cursor, 7)
      while (cursor < nextMonthEnd) {
        competences.push(cursor)
        cursor = addDaysUTC(cursor, 7)
      }
      return competences
    }
  }
}

/**
 * Início do período de competência corrente (não o próximo) — usado só pela
 * geração manual (Task 7), que não espera o gatilho `generationDayOfPeriod`
 * bater; o operador escolhe rodar na hora, pro período que está valendo hoje.
 */
export function computeCurrentPeriodStart(today: Date, periodicity: Periodicity): Date {
  switch (periodicity) {
    case 'MONTHLY':
      return startOfMonthUTC(today)
    case 'WEEKLY':
      return mondayOfWeek(today)
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3
      return new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1))
    }
    case 'ANNUAL':
      return new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  }
}

/**
 * Dado um instante arbitrário (não necessariamente "hoje"), retorna o início canônico do
 * período (semana/mês/trimestre/ano) em que ele cai. `computeCurrentPeriodStart` já opera
 * sobre uma data qualquer passada por parâmetro — nunca lê o relógio internamente — então essa
 * função é só um alias semântico pro mesmo cálculo, usado onde a entrada não é "hoje" mas um
 * `competenceOverride` arbitrário vindo da API (Task 7: geração manual) que precisa ser
 * canonicalizado pra bater com a chave de idempotência que o cron geraria pro mesmo período real.
 */
export function normalizeToPeriodStart(date: Date, periodicity: Periodicity): Date {
  return computeCurrentPeriodStart(date, periodicity)
}
