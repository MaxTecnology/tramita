// Period of the task list: "Este mês" (default), "Mês passado" or "Personalizado". Dates are
// calendar labels (YYYY-MM-DD) in the user's local calendar.
export type PeriodKind = 'this' | 'last' | 'custom'
export interface PeriodRange { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0')
const label = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function monthRange(year: number, month: number): PeriodRange {
  return { from: label(new Date(year, month, 1)), to: label(new Date(year, month + 1, 0)) }
}

export function periodRange(kind: PeriodKind, now: Date, custom: PeriodRange = { from: '', to: '' }): PeriodRange {
  if (kind === 'this') return monthRange(now.getFullYear(), now.getMonth())
  if (kind === 'last') return monthRange(now.getFullYear(), now.getMonth() - 1)
  return custom
}
