export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'CLOSED_BY_OFFICE'
export type CloseReason = 'APPROVED_OUTSIDE' | 'NO_RESPONSE'

export interface Approval {
  id: string
  taskId: string
  title: string
  message: string | null
  status: ApprovalStatus
  requestedAt: string
  requestedByName: string
  decidedAt: string | null
  decisionNote: string | null
  closeReason: CloseReason | null
  waitedDays: number | null
  decidedByName: string | null
  decidedByClient: boolean
  fileName: string
  fileUrl: string
  proofName: string | null
  proofUrl: string | null
}

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  APPROVED_OUTSIDE: 'Cliente aprovou fora da plataforma',
  NO_RESPONSE: 'Sem resposta do cliente',
}

export const APPROVAL_BADGE: Record<ApprovalStatus, { label: string; className: string }> = {
  PENDING: { label: 'Aguardando aprovação do cliente', className: 'bg-warning-bg text-warning-text' },
  APPROVED: { label: 'Aprovado', className: 'bg-success-bg text-success-text' },
  CHANGES_REQUESTED: { label: 'Ajuste pedido', className: 'bg-danger-bg text-danger-text' },
  CLOSED_BY_OFFICE: { label: 'Fechado pelo escritório', className: 'bg-neutral-bg text-muted-foreground' },
}

const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

// "Aprovado por Fulano em 13/11/2026", "Fechado pelo escritório: sem resposta do cliente — ..."
export function decisionText(a: Approval): string | null {
  if (a.status === 'PENDING' || !a.decidedAt) return null
  const by = a.decidedByName ? ` por ${a.decidedByName}` : ''
  if (a.status === 'APPROVED') return `Aprovado${by} em ${day(a.decidedAt)}`
  if (a.status === 'CHANGES_REQUESTED') return `Ajuste pedido${by} em ${day(a.decidedAt)}`
  const reason = a.closeReason ? CLOSE_REASON_LABEL[a.closeReason].toLowerCase() : ''
  const waited = a.waitedDays !== null ? ` (esperou ${a.waitedDays} dia${a.waitedDays === 1 ? '' : 's'})` : ''
  return `Fechado pelo escritório: ${reason}${by ? ` —${by.replace(' por', '')}` : ''} em ${day(a.decidedAt)}${waited}`
}
