export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

// targetDate/dueDate são rótulos de dia-calendário (meia-noite UTC), não instantes reais — mesma
// convenção de todo campo date-only no projeto (ver apps/web/src/lib/dates.ts). Comparar isso
// contra o instante bruto de `now` (como a versão antiga fazia) dispara o alerta ~3h adiantado,
// porque meia-noite UTC do rótulo cai às 21h BRT do dia anterior. A regra correta é dia-calendário
// em BRT: o rótulo só conta como dentro da janela quando o dia de HOJE em BRT (conversão real de
// fuso, já que `now` é um instante de verdade) alcança o threshold de dias antes do rótulo.
function utcDayLabel(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function todayInBRT(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'))
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function daysUntilLabel(label: number, today: number): number {
  return Math.round((label - today) / ONE_DAY_MS)
}

// DUE_CRITICAL tem prioridade sobre TARGET_WARNING quando ambos os níveis se aplicam ao mesmo
// tempo — o vencimento real é sempre mais urgente que a meta interna do escritório.
export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  const today = todayInBRT(now)
  if (dueDate && daysUntilLabel(utcDayLabel(dueDate), today) <= config.slaDueCriticalDays) {
    return 'DUE_CRITICAL'
  }
  if (targetDate && daysUntilLabel(utcDayLabel(targetDate), today) <= config.slaTargetWarningDays) {
    return 'TARGET_WARNING'
  }
  return 'NONE'
}
