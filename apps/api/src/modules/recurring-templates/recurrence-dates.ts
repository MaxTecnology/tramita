export type Periodicity = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
export type BusinessDayRoll = 'NONE' | 'FORWARD' | 'BACKWARD'

export interface RecurrenceDateRules {
  periodicity: Periodicity
  dueDayOfPeriod: number
  dueBusinessDayRoll: BusinessDayRoll
  competenceMonthOffset: number
  targetOffsetDays: number
  targetBusinessDayRoll: BusinessDayRoll
  generationMonthOffset: number
  generationDayOfPeriod: number
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function rollToBusinessDay(date: Date, direction: BusinessDayRoll): Date {
  if (direction === 'NONE') return date
  const step = direction === 'FORWARD' ? 1 : -1
  const result = new Date(date)
  while (isWeekend(result)) {
    result.setUTCDate(result.getUTCDate() + step)
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

/**
 * Vencimento pra periodicidade WEEKLY — a única que ainda usa "competência" como entrada
 * primária (a competência É a segunda-feira da semana, não existe ambiguidade com vencimento
 * nesse caso, por isso essa periodicidade ficou fora do redesenho vencimento-como-âncora).
 */
export function computeDueDate(competence: Date, rules: RecurrenceDateRules): Date {
  const due = addDaysUTC(competence, rules.dueDayOfPeriod - 1)
  return rollToBusinessDay(due, rules.dueBusinessDayRoll)
}

/**
 * Vencimento a partir do mês-alvo já decidido — usada por MONTHLY/QUARTERLY/ANNUAL, onde
 * vencimento é a âncora (não mais derivado de uma "competência" abstrata).
 */
export function computeDueDateFromMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  if (rules.periodicity === 'WEEKLY') {
    throw new Error('computeDueDateFromMonth não serve pra WEEKLY — use computeDueDate')
  }
  const year = dueMonthStart.getUTCFullYear()
  const month = dueMonthStart.getUTCMonth()
  const day = clampDayOfMonth(year, month, rules.dueDayOfPeriod)
  const due = new Date(Date.UTC(year, month, day))
  return rollToBusinessDay(due, rules.dueBusinessDayRoll)
}

/** Competência derivada do mês de vencimento — sempre `competenceMonthOffset` meses antes. */
export function computeCompetenceFromDueMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  if (rules.periodicity === 'WEEKLY') {
    throw new Error('computeCompetenceFromDueMonth não serve pra WEEKLY — dueMonth já É a competência nesse caso')
  }
  return addMonthsUTC(dueMonthStart, -rules.competenceMonthOffset)
}

/**
 * Inverso de computeCompetenceFromDueMonth — dado uma competência já conhecida (ex: de um
 * log de geração que falhou), devolve o mês de vencimento que a gerou. Pra WEEKLY, dueMonth
 * É a própria competência (mesma convenção usada em generateTaskForAssignment). Usado pelo
 * retry de falhas: regenerar com a MESMA competência que falhou, não com um valor arbitrário.
 */
export function computeDueMonthFromCompetence(
  competence: Date,
  rules: Pick<RecurrenceDateRules, 'periodicity' | 'competenceMonthOffset'>,
): Date {
  if (rules.periodicity === 'WEEKLY') return competence
  return addMonthsUTC(competence, rules.competenceMonthOffset)
}

export function computeTargetDate(dueDate: Date, rules: RecurrenceDateRules): Date {
  const target = addDaysUTC(dueDate, rules.targetOffsetDays)
  return rollToBusinessDay(target, rules.targetBusinessDayRoll)
}

/**
 * Pro cron: decide, pro dia de hoje, quais meses de VENCIMENTO devem ser gerados.
 * Só serve pras periodicidades MONTHLY/QUARTERLY/ANNUAL — WEEKLY usa `computeCompetencesToGenerate`
 * (ver abaixo), porque pra ela "mês de vencimento" não é um conceito que faça sentido isolado
 * (uma semana pode atravessar dois meses).
 */
export function computeDueMonthsToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  if (rules.periodicity === 'WEEKLY') {
    throw new Error('WEEKLY usa computeCompetencesToGenerate, não computeDueMonthsToGenerate')
  }

  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const dueMonthStart = addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)

  switch (rules.periodicity) {
    case 'MONTHLY':
      return [dueMonthStart]
    case 'QUARTERLY':
      return dueMonthStart.getUTCMonth() % 3 === 0 ? [dueMonthStart] : []
    case 'ANNUAL':
      return dueMonthStart.getUTCMonth() === 0 ? [dueMonthStart] : []
  }
}

/**
 * Pro cron: decide quais competências (semanas) gerar hoje — só serve pra WEEKLY.
 * MONTHLY/QUARTERLY/ANNUAL usam `computeDueMonthsToGenerate`.
 */
export function computeCompetencesToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  if (rules.periodicity !== 'WEEKLY') {
    throw new Error('computeCompetencesToGenerate só serve pra WEEKLY — use computeDueMonthsToGenerate pras demais periodicidades')
  }

  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const competenceMonthStart = addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)
  const competenceMonthEnd = addMonthsUTC(competenceMonthStart, 1)
  const competences: Date[] = []
  let cursor = mondayOfWeek(competenceMonthStart)
  if (cursor < competenceMonthStart) cursor = addDaysUTC(cursor, 7)
  while (cursor < competenceMonthEnd) {
    competences.push(cursor)
    cursor = addDaysUTC(cursor, 7)
  }
  return competences
}

/**
 * Todas as segundas-feiras (= competências semanais) dentro do mês calendário que contém
 * `monthDate`. Diferente de computeCompetencesToGenerate (que deriva o mês a partir de "hoje"
 * + generationMonthOffset, pro cron), esta função recebe o mês já escolhido explicitamente —
 * usada pela geração em lote, onde o operador escolhe o mês na tela.
 */
export function computeWeeklyCompetencesInMonth(monthDate: Date): Date[] {
  const monthStart = startOfMonthUTC(monthDate)
  const monthEnd = addMonthsUTC(monthStart, 1)
  const competences: Date[] = []
  let cursor = mondayOfWeek(monthStart)
  if (cursor < monthStart) cursor = addDaysUTC(cursor, 7)
  while (cursor < monthEnd) {
    competences.push(cursor)
    cursor = addDaysUTC(cursor, 7)
  }
  return competences
}

/**
 * Início do período de competência corrente (não o próximo) — usado só pela
 * geração manual, que não espera o gatilho `generationDayOfPeriod` bater; o
 * operador escolhe rodar na hora, pro período que está valendo hoje.
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
 * período (semana/mês/trimestre/ano) em que ele cai. Usado pra canonicalizar um override
 * arbitrário vindo da API (geração manual/lote) pra bater com a chave de idempotência que
 * o cron geraria pro mesmo período real.
 */
export function normalizeToPeriodStart(date: Date, periodicity: Periodicity): Date {
  return computeCurrentPeriodStart(date, periodicity)
}

/**
 * Mês de vencimento do "próximo ciclo normal" do template, a partir de hoje — mesma conta
 * que o cron usaria se disparasse hoje, mas sem exigir que hoje seja o generationDayOfPeriod.
 * Usado por `generateManually` quando o operador não escolhe um mês explícito: "Gerar agora"
 * sem seletor deve fazer o que o cron faria no próximo disparo, não um "mês atual" cru.
 */
export function computeNextDueMonth(today: Date, rules: RecurrenceDateRules): Date {
  if (rules.periodicity === 'WEEKLY') return computeCurrentPeriodStart(today, rules.periodicity)
  return addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)
}
