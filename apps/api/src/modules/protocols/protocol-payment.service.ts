import { storageSafeName } from '@/lib/upload-policy'
import { prisma } from '@/lib/prisma'
import { discardUploadedAttachment } from './protocol-from-deliverable'
import { AppError } from '@/errors/AppError'
import { formatBRL, parseMoney } from '@/lib/money'
import { uploadFile } from '@/lib/b2'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import type { UploadPayload } from '@/modules/task-documents/task-documents.service'

// Document as the client user sees it: same organization, not cancelled, department in the
// user's access. Anything else answers 404 (never reveals that it exists).
export async function findProtocolForClient(protocolId: string, organizationId: string, clientUserId: string) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId, cancelledAt: null },
    include: { task: { select: { departmentId: true } } },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  const scope = await getClientAccessScope(clientUserId)
  if (!canSeeTask(scope, protocol.clientId, protocol.task.departmentId)) throw new AppError(404, 'Protocolo não encontrado')
  return protocol
}

async function clientActor(clientUserId: string) {
  const u = await prisma.clientUser.findUnique({ where: { id: clientUserId }, select: { name: true, email: true } })
  return { name: u?.name ?? 'Cliente', email: u?.email ?? null }
}

// Only the client marks a guide as paid — it is the client's own control; the office just sees it.
export async function markProtocolPaid(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  input: { amount: string; proof?: UploadPayload },
) {
  const protocol = await findProtocolForClient(protocolId, organizationId, clientUserId)
  if (!protocol.requiresPayment) throw new AppError(422, 'Esse documento não é uma guia de pagamento')
  if (protocol.paidAt) throw new AppError(409, 'Essa guia já está marcada como paga')
  const amount = parseMoney(input.amount)

  let proofAttachmentId: string | undefined
  if (input.proof) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
    const storageKey = `payment-proofs/${org?.slug ?? organizationId}/${protocol.taskId}/${Date.now()}-${storageSafeName(input.proof.filename)}`
    await uploadFile(storageKey, input.proof.buffer, input.proof.mimeType)
    const attachment = await prisma.attachment.create({
      data: {
        taskId: protocol.taskId, filename: input.proof.filename, mimeType: input.proof.mimeType,
        size: input.proof.size, storageKey, uploadedByClient: protocol.clientId,
      },
    })
    proofAttachmentId = attachment.id
  }

  const actor = await clientActor(clientUserId)
  try {
    return await prisma.$transaction(async (tx) => {
      // Guarded write: two simultaneous clicks produce a single PAID
      const { count } = await tx.protocol.updateMany({
        where: { id: protocol.id, paidAt: null, cancelledAt: null },
        data: { paidAt: new Date(), paidAmount: amount, paidByClientUserId: clientUserId, paymentProofAttachmentId: proofAttachmentId ?? null },
      })
      if (count === 0) {
        const current = await tx.protocol.findUnique({ where: { id: protocol.id }, select: { cancelledAt: true } })
        throw new AppError(409, current?.cancelledAt ? 'Esse documento foi cancelado pelo escritório' : 'Essa guia já está marcada como paga')
      }
      const base = { protocolId: protocol.id, actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email }
      await tx.protocolEvent.create({ data: { ...base, type: 'PAID', detail: formatBRL(amount) } })
      // Paying implies having seen it — also lifts it out of "vencido sem visualização"
      if (protocol.status === 'SENT' || protocol.status === 'EXPIRED') {
        await tx.protocolEvent.create({ data: { ...base, type: 'VIEWED' } })
        await tx.protocol.updateMany({ where: { id: protocol.id, status: { in: ['SENT', 'EXPIRED'] } }, data: { status: 'VIEWED' } })
      }
      return tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    })
  } catch (err) {
    if (proofAttachmentId) await discardUploadedAttachment(proofAttachmentId) // proof of a payment that did not happen
    throw err
  }
}

// Undo (marked by mistake). The proof file stays in the task attachments as history.
export async function unmarkProtocolPaid(protocolId: string, organizationId: string, clientUserId: string) {
  const protocol = await findProtocolForClient(protocolId, organizationId, clientUserId)
  if (!protocol.paidAt) throw new AppError(409, 'Essa guia não está marcada como paga')

  const actor = await clientActor(clientUserId)
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.protocol.updateMany({
      where: { id: protocol.id, paidAt: { not: null } },
      data: { paidAt: null, paidAmount: null, paidByClientUserId: null, paymentProofAttachmentId: null },
    })
    if (count === 0) throw new AppError(409, 'Essa guia não está marcada como paga')
    await tx.protocolEvent.create({
      data: { protocolId: protocol.id, type: 'UNPAID', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email },
    })
    return tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
  })
}
