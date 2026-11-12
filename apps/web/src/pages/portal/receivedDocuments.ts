export interface ReceivedDocument {
  id: string
  number: string
  title: string
  dueDate: string | null
  status: 'SENT' | 'VIEWED' | 'DOWNLOADED' | 'EXPIRED'
  attachmentId: string | null
  createdAt: string
  competence: string | null
  requiresPayment: boolean
  amount: string | null
  paidAt: string | null
  paidAmount: string | null
  fileUpdatedAt: string | null
  departmentName: string
}

export type DocumentState = 'paid' | 'unpaid-overdue' | 'unpaid' | 'seen' | 'unseen'

// What the client cares about first: payment (for guides), then whether they've seen it.
export function documentState(d: Pick<ReceivedDocument, 'requiresPayment' | 'paidAt' | 'status' | 'dueDate'>, overdue: boolean): DocumentState {
  if (d.requiresPayment) {
    if (d.paidAt) return 'paid'
    return overdue ? 'unpaid-overdue' : 'unpaid'
  }
  return d.status === 'SENT' || d.status === 'EXPIRED' ? 'unseen' : 'seen'
}

export const STATE_UI: Record<DocumentState, { label: string; cls: string }> = {
  paid: { label: 'Pago', cls: 'bg-success-bg text-success-text' },
  'unpaid-overdue': { label: 'Vencida — não paga', cls: 'bg-danger-bg text-danger-text' },
  unpaid: { label: 'A pagar', cls: 'bg-warning-bg text-warning-text' },
  seen: { label: 'Visto', cls: 'bg-neutral-bg text-neutral-text' },
  unseen: { label: 'Não visto', cls: 'bg-blue-500/10 text-accent-hover' },
}
