import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { buildPaymentInfo, insertProtocol } from './protocols.service'

export const PAID_GUIDE_LOCKED =
  'Essa guia já foi marcada como paga pelo cliente. Peça para ele desfazer o pagamento antes de substituir.'
export const CANCELLED_PROTOCOL_LOCKED = 'Protocolo cancelado não pode ser alterado'

export interface ProtocolPaymentPatch {
  amount?: string | null
  dueDate?: Date | null
}

// Guards shared by every path that changes a sent document (re-delivery, replace, payment edit).
export function assertProtocolEditable(p: { paidAt: Date | null; cancelledAt: Date | null }) {
  if (p.cancelledAt) throw new AppError(409, CANCELLED_PROTOCOL_LOCKED)
  if (p.paidAt) throw new AppError(409, PAID_GUIDE_LOCKED)
}

// Swaps the file of an existing protocol, keeping the previous one in the history (REPLACED). The
// client sees only the current file and is notified again.
export async function replaceProtocolFileCore(
  protocolId: string,
  attachmentId: string,
  actor: { id: string },
  payment: ProtocolPaymentPatch = {},
) {
  const current = await prisma.protocol.findUniqueOrThrow({ where: { id: protocolId } })
  assertProtocolEditable(current)

  const staff = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } })
  const updated = await prisma.$transaction(async (tx) => {
    // Guarded write: a payment registered between the read above and here wins (no silent overwrite)
    const { count } = await tx.protocol.updateMany({
      where: { id: protocolId, paidAt: null, cancelledAt: null },
      data: {
        attachmentId,
        fileUpdatedAt: new Date(),
        status: 'SENT',
        ...(payment.amount !== undefined ? { amount: payment.amount } : {}),
        ...(payment.dueDate !== undefined ? { dueDate: payment.dueDate } : {}),
      },
    })
    if (count === 0) throw new AppError(409, PAID_GUIDE_LOCKED)
    await tx.protocolEvent.create({
      data: {
        protocolId,
        type: 'REPLACED',
        actorType: 'user',
        actorId: actor.id,
        actorName: staff?.name ?? null,
        actorEmail: staff?.email ?? null,
        previousAttachmentId: current.attachmentId,
      },
    })
    return tx.protocol.findUniqueOrThrow({ where: { id: protocolId } })
  })

  await enqueueNotification({
    event: 'PROTOCOL_CREATED',
    organizationId: updated.organizationId,
    clientId: updated.clientId,
    taskId: updated.taskId,
    metadata: { protocolTitle: updated.title, paymentInfo: buildPaymentInfo(updated) },
  })
  return updated
}

// One protocol per delivery: creates it on the first delivery of a client-visible task, swaps the
// file on re-delivery. Returns null when the task is internal (not visible to the client).
export async function upsertProtocolForDeliverable(deliverableId: string, actor: { id: string }) {
  const deliverable = await prisma.taskDeliverable.findUniqueOrThrow({
    where: { id: deliverableId },
    include: {
      protocol: true,
      task: { include: { column: { include: { board: { select: { clientId: true, organizationId: true } } } } } },
    },
  })
  const { task } = deliverable
  if (!task.visibleToClient || !deliverable.attachmentId) return null

  const dueDate = deliverable.paymentDueDate ?? task.dueDate
  if (deliverable.protocol) {
    if (deliverable.protocol.attachmentId === deliverable.attachmentId) return deliverable.protocol
    return replaceProtocolFileCore(deliverable.protocol.id, deliverable.attachmentId, actor, {
      amount: deliverable.amount?.toString() ?? null,
      dueDate,
    })
  }

  return insertProtocol({
    organizationId: task.column.board.organizationId,
    clientId: task.column.board.clientId,
    taskId: task.id,
    title: deliverable.name,
    attachmentId: deliverable.attachmentId,
    dueDate,
    competence: task.competence,
    requiresPayment: deliverable.requiresPayment,
    amount: deliverable.amount?.toString() ?? null,
    deliverableId: deliverable.id,
    createdById: actor.id,
  })
}

// Task turned visible to the client: deliveries already done get their protocol now.
export async function syncProtocolsForTask(taskId: string, actor: { id: string }): Promise<number> {
  const pending = await prisma.taskDeliverable.findMany({
    where: { taskId, deliveredAt: { not: null }, attachmentId: { not: null }, protocol: null },
    select: { id: true },
    orderBy: { position: 'asc' },
  })
  for (const d of pending) await upsertProtocolForDeliverable(d.id, actor)
  return pending.length
}
