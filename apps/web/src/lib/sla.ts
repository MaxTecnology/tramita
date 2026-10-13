export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

// targetDate/dueDate são rótulos de dia-calendário (meia-noite UTC), não instantes reais — mesma
// convenção de apps/web/src/lib/dates.ts. `now` é um instante real; usamos os getters LOCAIS do
// navegador (assumido BRT, mesma premissa de dates.ts) pra saber o dia de hoje de verdade, em vez
// de comparar o rótulo contra o instante bruto (dispara ~3h adiantado — ver backend sla.ts).
function utcDayLabel(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function todayLocal(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function daysUntilLabel(label: number, today: number): number {
  return Math.round((label - today) / ONE_DAY_MS)
}

export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  const today = todayLocal(now)
  if (dueDate && daysUntilLabel(utcDayLabel(dueDate), today) <= config.slaDueCriticalDays) {
    return 'DUE_CRITICAL'
  }
  if (targetDate && daysUntilLabel(utcDayLabel(targetDate), today) <= config.slaTargetWarningDays) {
    return 'TARGET_WARNING'
  }
  return 'NONE'
}
