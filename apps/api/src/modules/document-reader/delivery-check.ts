import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { extrairEInterpretar } from './engine/pipeline'
import { carregarModelosDaOrg, resolverClientePorIdentificador, competenciaParaRotulo, pagamentoLido } from './document-reader.service'

// The robot as a checker of manual deliveries: before a file goes into a delivery marked for the robot
// (ex.: "Guia DAS" → DAS), it reads it and compares with the task. `blocked` can never be overridden
// (a document of another client of the office); `warnings` ask the person to confirm.
export interface DeliveryCheck {
  blocked?: string
  warnings: string[]
  read: { amount?: string; dueDate?: string }
}

const UNREADABLE = 'O robô não conseguiu conferir este arquivo'
type Campo = { bruto: string; valor: string | number | null; valido: boolean }
const fmt = (r: string) => `${r.slice(5, 7)}/${r.slice(0, 4)}`

export async function checkDeliveryFile(
  taskId: string,
  deliverableId: string,
  organizationId: string,
  file: { buffer: Buffer; mimeType: string },
): Promise<DeliveryCheck> {
  const deliverable = await prisma.taskDeliverable.findFirst({
    where: { id: deliverableId, taskId, task: { column: { board: { organizationId } } } },
    select: {
      requiresPayment: true,
      obligationType: { select: { code: true, name: true } },
      task: { select: { competence: true, column: { select: { board: { select: { client: { select: { id: true, name: true } } } } } } } },
    },
  })
  // No robot on this delivery (or not found: the delivery route answers the usual 404)
  if (!deliverable?.obligationType) return { warnings: [], read: {} }
  if (file.mimeType !== 'application/pdf') return { warnings: [UNREADABLE], read: {} }

  // Loading the models is infrastructure: a failure there is an error, never "could not read" (which
  // the person may accept and deliver unchecked)
  const modelos = await carregarModelosDaOrg(organizationId)
  let resultado
  try {
    const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength)
    resultado = await extrairEInterpretar(bytes, modelos)
  } catch (err) {
    logger.warn({ taskId, deliverableId, reason: err instanceof Error ? err.message : String(err) }, 'Robô não leu o arquivo da entrega')
    return { warnings: [UNREADABLE], read: {} }
  }
  if (resultado.status === 'sem_texto' || resultado.status === 'nao_identificado') return { warnings: [UNREADABLE], read: {} }

  const campos = resultado.campos as Record<string, Campo>
  const taskClient = deliverable.task.column.board.client
  const warnings: string[] = []

  // CNPJ: another client of the office blocks; unknown or unread warns
  const cnpj = campos.cnpj
  if (cnpj?.valido && cnpj.valor) {
    const dono = await resolverClientePorIdentificador(organizationId, String(cnpj.valor))
    if (dono && dono.id !== taskClient.id) {
      return { blocked: `Este documento é de ${dono.name} — não pode ser entregue a ${taskClient.name}`, warnings: [], read: {} }
    }
    if (!dono) warnings.push(`O CNPJ do documento (${cnpj.bruto}) não é de nenhum cliente do escritório`)
  } else {
    warnings.push('O robô não leu o CNPJ do documento')
  }

  if (resultado.tipoImposto && resultado.tipoImposto !== deliverable.obligationType.code) {
    warnings.push(`Não parece ser ${deliverable.obligationType.name} (o robô reconheceu outro tipo de documento)`)
  }

  const lida = [campos.competencia, campos.pa].find((c) => c?.valido && /^\d{4}-\d{2}$/.test(String(c.valor)))
  const esperada = competenciaParaRotulo(deliverable.task.competence)
  if (lida && esperada && String(lida.valor) !== esperada) {
    warnings.push(`Competência do documento: ${fmt(String(lida.valor))} — a tarefa é de ${fmt(esperada)}`)
  }

  const pago = pagamentoLido({ extractedFields: campos })
  if (deliverable.requiresPayment && (!pago.amount || !pago.paymentDueDate)) {
    warnings.push('O robô não leu o valor e o vencimento da guia — confira ao entregar')
  }

  return {
    warnings,
    read: { ...(pago.amount ? { amount: pago.amount } : {}), ...(pago.paymentDueDate ? { dueDate: pago.paymentDueDate } : {}) },
  }
}
