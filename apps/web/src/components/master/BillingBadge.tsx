import { cn } from '@/lib/utils'
import { diffDaysDateOnlyUTC, formatDateOnlyUTC } from '@/lib/dates'

export type BillingMode = 'ASAAS' | 'MANUAL'

const WARN_DAYS = 5

// How the office pays AutoHubs; a direct agreement shows when it is due (only a reminder: the
// Master decides what to do when it is late)
export function BillingBadge({ billingMode, manualNextDueDate, now = new Date() }: {
  billingMode: BillingMode
  manualNextDueDate: string | null
  now?: Date
}) {
  if (billingMode === 'ASAAS') return <span className="text-xs text-muted-foreground">Asaas</span>

  let due: { text: string; tone: string }
  if (!manualNextDueDate) {
    due = { text: 'sem vencimento', tone: 'text-muted-foreground' }
  } else {
    const days = diffDaysDateOnlyUTC(manualNextDueDate, now)
    if (days < 0) due = { text: `vencido em ${formatDateOnlyUTC(manualNextDueDate)}`, tone: 'text-danger-text font-medium' }
    else if (days === 0) due = { text: 'vence hoje', tone: 'text-warning-text font-medium' }
    else if (days <= WARN_DAYS) due = { text: `vence em ${days} ${days === 1 ? 'dia' : 'dias'}`, tone: 'text-warning-text font-medium' }
    else due = { text: `vence ${formatDateOnlyUTC(manualNextDueDate)}`, tone: 'text-muted-foreground' }
  }

  return (
    <span className="flex flex-col leading-tight">
      <span className="text-xs text-foreground">Acerto direto</span>
      <span className={cn('text-[11px]', due.tone)}>{due.text}</span>
    </span>
  )
}
