// Mirror of the API's recurrence-dates.ts for the template form: the next generations and a plain
// sentence of the rule, computed on screen while the office adjusts the template (no round trip).
// On the generation day of month G the task due in month G + generationMonthOffset is created.

export type Roll = 'NONE' | 'FORWARD' | 'BACKWARD'
export interface PreviewRules {
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  dueDayOfPeriod: number
  dueBusinessDayRoll: Roll
  dueMonthAnchor: number
  competenceMonthOffset: number
  targetOffsetDays: number
  targetBusinessDayRoll: Roll
  generationMonthOffset: number
  generationDayOfPeriod: number
}

export interface Occurrence { createdOn: Date; target: Date; due: Date; competence: Date }

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const utc = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m, day))
const clampDay = (y: number, m: number, day: number) => Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())

function roll(date: Date, direction: Roll): Date {
  if (direction === 'NONE') return date
  const step = direction === 'FORWARD' ? 1 : -1
  const r = new Date(date)
  while (r.getUTCDay() === 0 || r.getUTCDay() === 6) r.setUTCDate(r.getUTCDate() + step)
  return r
}

function dueMonthMatches(rules: PreviewRules, month: number): boolean {
  if (rules.periodicity === 'QUARTERLY') return month % 3 === (rules.dueMonthAnchor - 1) % 3
  if (rules.periodicity === 'ANNUAL') return month === rules.dueMonthAnchor - 1
  return true
}

export function nextOccurrences(rules: PreviewRules, today: Date, count: number): Occurrence[] {
  if (rules.periodicity === 'WEEKLY') return []
  const out: Occurrence[] = []
  const todayDay = utc(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  // Walk generation months from the current one; at most 3 years ahead (annual templates)
  for (let i = 0; i < 40 && out.length < count; i++) {
    const g = utc(today.getUTCFullYear(), today.getUTCMonth() + i)
    const createdOn = utc(g.getUTCFullYear(), g.getUTCMonth(), clampDay(g.getUTCFullYear(), g.getUTCMonth(), rules.generationDayOfPeriod))
    if (createdOn < todayDay) continue
    const dueMonth = utc(g.getUTCFullYear(), g.getUTCMonth() + rules.generationMonthOffset)
    if (!dueMonthMatches(rules, dueMonth.getUTCMonth())) continue
    const y = dueMonth.getUTCFullYear()
    const m = dueMonth.getUTCMonth()
    const due = roll(utc(y, m, clampDay(y, m, rules.dueDayOfPeriod)), rules.dueBusinessDayRoll)
    const targetRaw = new Date(due)
    targetRaw.setUTCDate(targetRaw.getUTCDate() + rules.targetOffsetDays)
    out.push({ createdOn, due, target: roll(targetRaw, rules.targetBusinessDayRoll), competence: utc(y, m - rules.competenceMonthOffset) })
  }
  return out
}

const WEEKDAY = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export function describeRule(rules: PreviewRules): string {
  const rollText = rules.dueBusinessDayRoll === 'FORWARD'
    ? ' (adiado para o próximo dia útil se cair no fim de semana)'
    : rules.dueBusinessDayRoll === 'BACKWARD' ? ' (antecipado para o dia útil anterior se cair no fim de semana)' : ''
  const target = rules.targetOffsetDays === 0
    ? 'no dia do vencimento'
    : `${Math.abs(rules.targetOffsetDays)} ${Math.abs(rules.targetOffsetDays) === 1 ? 'dia' : 'dias'} ${rules.targetOffsetDays < 0 ? 'antes' : 'depois'} do vencimento`

  if (rules.periodicity === 'WEEKLY') {
    return `Toda semana, vence na ${WEEKDAY[rules.dueDayOfPeriod] ?? ''}${rollText}. Meta interna: ${target}.`
  }

  const period = rules.periodicity === 'MONTHLY'
    ? 'Todo mês'
    : rules.periodicity === 'QUARTERLY'
      ? `A cada trimestre (${[0, 3, 6, 9].map((k) => SHORT[(rules.dueMonthAnchor - 1 + k) % 12]).join(', ')})`
      : `Todo ano em ${MONTHS[rules.dueMonthAnchor - 1]}`
  const competence = rules.competenceMonthOffset === 0
    ? 'referente ao mesmo mês'
    : rules.competenceMonthOffset === 1 ? 'referente ao mês anterior' : `referente a ${rules.competenceMonthOffset} meses antes`
  const day = rules.generationDayOfPeriod
  const created = rules.generationMonthOffset === 0
    ? `no dia ${day} do mesmo mês do vencimento`
    : rules.generationMonthOffset === 1
      ? `no dia ${day} do mês anterior ao vencimento`
      : `no dia ${day} de ${rules.generationMonthOffset} meses antes do vencimento`
  return `${period}, vence no dia ${rules.dueDayOfPeriod}${rollText}, ${competence}. Meta interna: ${target}. A tarefa é criada ${created}.`
}
