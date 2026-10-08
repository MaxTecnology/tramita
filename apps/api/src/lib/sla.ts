export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

function subtractDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

// DUE_CRITICAL tem prioridade sobre TARGET_WARNING quando ambos os níveis se aplicam ao mesmo
// tempo — o vencimento real é sempre mais urgente que a meta interna do escritório.
export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  if (dueDate && now >= subtractDaysUTC(dueDate, config.slaDueCriticalDays)) {
    return 'DUE_CRITICAL'
  }
  if (targetDate && now >= subtractDaysUTC(targetDate, config.slaTargetWarningDays)) {
    return 'TARGET_WARNING'
  }
  return 'NONE'
}
