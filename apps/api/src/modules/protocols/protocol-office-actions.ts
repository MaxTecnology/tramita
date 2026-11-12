import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { formatBRL, parseMoney } from '@/lib/money'
import { memberBoardWhere } from '@/modules/boards/board-visibility'
import { createAttachment } from '@/modules/attachments/attachments.service'
import type { UploadPayload } from '@/modules/task-documents/task-documents.service'
import { assertProtocolEditable, replaceProtocolFileCore, lockedProtocolError, discardUploadedAttachment } from './protocol-from-deliverable'

export interface StaffActor {
  id: string
  role: string
}

// "YYYY-MM-DD" → midnight UTC (date-only label)
export function parseDueDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, 'Data de vencimento inválida')
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'Data de vencimento inválida')
  return d
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—')

// Protocol as the office user sees it: same organization and, for ORG_MEMBER, a process visible to
// them (board-visibility). Outside the scope answers 404 like "not found".
export async function findProtocolForStaff(protocolId: string, organizationId: string, actor: StaffActor) {
  const protocol = await prisma.protocol.findFirst({
    where: {
      id: protocolId,
      organizationId,
      ...(actor.role === 'ORG_MEMBER' ? { task: { column: { board: memberBoardWhere(actor.id) } } } : {}),
    },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  return protocol
}

export async function replaceProtocolFile(
  protocolId: string,
  organizationId: string,
  actor: StaffActor,
  payload: UploadPayload,
  payment: { amount?: string; paymentDueDate?: string } = {},
) {
  const protocol = await findProtocolForStaff(protocolId, organizationId, actor)
  assertProtocolEditable(protocol)
  // Amount and due date only mean something on a payment guide
  const amount = protocol.requiresPayment && payment.amount ? parseMoney(payment.amount) : undefined
  const dueDate = protocol.requiresPayment && payment.paymentDueDate ? parseDueDate(payment.paymentDueDate) : undefined

  const attachment = await createAttachment(protocol.taskId, organizationId, actor, payload)
  let updated: Awaited<ReturnType<typeof replaceProtocolFileCore>>
  try {
    updated = await replaceProtocolFileCore(protocol.id, attachment.id, actor, { amount, dueDate })
  } catch (err) {
    await discardUploadedAttachment(attachment.id) // lost to a payment/cancellation: no orphan file
    throw err
  }

  // Keep the delivery checklist in sync with the document the client sees
  if (protocol.deliverableId) {
    await prisma.taskDeliverable.update({
      where: { id: protocol.deliverableId },
      data: {
        attachmentId: attachment.id, deliveredById: actor.id, deliveredAt: new Date(),
        ...(amount !== undefined ? { amount } : {}),
        ...(dueDate !== undefined ? { paymentDueDate: dueDate } : {}),
      },
    })
  }
  return updated
}

export async function updateProtocolPayment(
  protocolId: string,
  organizationId: string,
  actor: StaffActor,
  input: { amount?: string; dueDate?: string },
) {
  const protocol = await findProtocolForStaff(protocolId, organizationId, actor)
  assertProtocolEditable(protocol)
  if (!protocol.requiresPayment) throw new AppError(422, 'Esse documento não é uma guia de pagamento')

  const amount = input.amount ? parseMoney(input.amount) : undefined
  const dueDate = input.dueDate ? parseDueDate(input.dueDate) : undefined
  if (amount === undefined && dueDate === undefined) throw new AppError(400, 'Informe o valor ou o vencimento')

  const changes: string[] = []
  if (amount !== undefined) changes.push(`${protocol.amount ? formatBRL(protocol.amount) : '—'} → ${formatBRL(amount)}`)
  if (dueDate !== undefined) changes.push(`vencimento ${fmtDate(protocol.dueDate)} → ${fmtDate(dueDate)}`)

  const staff = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } })
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.protocol.updateMany({
      where: { id: protocol.id, paidAt: null, cancelledAt: null },
      data: { ...(amount !== undefined ? { amount } : {}), ...(dueDate !== undefined ? { dueDate } : {}) },
    })
    if (count === 0) throw await lockedProtocolError(protocol.id)
    if (protocol.deliverableId) {
      await tx.taskDeliverable.update({
        where: { id: protocol.deliverableId },
        data: { ...(amount !== undefined ? { amount } : {}), ...(dueDate !== undefined ? { paymentDueDate: dueDate } : {}) },
      })
    }
    await tx.protocolEvent.create({
      data: {
        protocolId: protocol.id, type: 'AMOUNT_CHANGED', actorType: 'user', actorId: actor.id,
        actorName: staff?.name ?? null, actorEmail: staff?.email ?? null, detail: changes.join('; '),
      },
    })
    return tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
  })
}

// Exception path (document that should never exist, e.g. sent to the wrong client): leaves the
// client's view and every indicator; file and record are never deleted.
export async function cancelProtocol(protocolId: string, organizationId: string, actor: StaffActor, reason: string) {
  const protocol = await findProtocolForStaff(protocolId, organizationId, actor)
  if (protocol.cancelledAt) throw new AppError(409, 'Esse documento já foi cancelado')

  const staff = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } })
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.protocol.updateMany({
      where: { id: protocol.id, cancelledAt: null },
      data: { cancelledAt: new Date(), cancelledById: actor.id, cancellationReason: reason },
    })
    if (count === 0) throw new AppError(409, 'Esse documento já foi cancelado')
    await tx.protocolEvent.create({
      data: {
        protocolId: protocol.id, type: 'CANCELLED', actorType: 'user', actorId: actor.id,
        actorName: staff?.name ?? null, actorEmail: staff?.email ?? null, detail: reason,
      },
    })
    return tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
  })
}
