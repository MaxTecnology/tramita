import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import { Prisma, type MessageChannel } from '@prisma/client'
import { enqueueNotification } from '@/lib/queue'
import { logger } from '@/lib/logger'
import { ensureRecurringSystemBoard } from '@/modules/tasks/tasks.service'
import { notifyIfBlocked } from '@/modules/task-documents/task-documents.service'
import {
  computeDueDate,
  computeDueDateFromMonth,
  computeCompetenceFromDueMonth,
  computeDueMonthFromCompetence,
  computeTargetDate,
  computeNextDueMonth,
  normalizeToPeriodStart,
  computeWeeklyCompetencesInMonth,
  type RecurrenceDateRules,
} from './recurrence-dates'
import type {
  CreateTemplateBody,
  UpdateTemplateBody,
  CreateAssignmentBody,
  UpdateAssignmentBody,
} from './recurring-templates.schema'

function assertDayOfPeriodValid(periodicity: string, dueDayOfPeriod: number, generationDayOfPeriod: number) {
  if (periodicity === 'WEEKLY') {
    if (dueDayOfPeriod > 7) {
      throw new AppError(400, 'Periodicidade semanal: dia do vencimento deve ser de 1 (segunda) a 7 (domingo)')
    }
  }
  if (generationDayOfPeriod > 31 || generationDayOfPeriod < 1) {
    throw new AppError(400, 'Dia de geração deve ser de 1 a 31')
  }
}

export async function listTemplates(organizationId: string) {
  return prisma.recurringTaskTemplate.findMany({
    where: { organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
    orderBy: { title: 'asc' },
  })
}

export async function getTemplateById(id: string, organizationId: string) {
  const template = await prisma.recurringTaskTemplate.findFirst({
    where: { id, organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
  })
  if (!template) throw new AppError(404, 'Template não encontrado')
  return template
}

export async function createTemplate(organizationId: string, data: CreateTemplateBody) {
  await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(data.periodicity, data.dueDayOfPeriod, data.generationDayOfPeriod)

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.recurringTaskTemplate.create({
    data: {
      ...templateData,
      organizationId,
      documentRequests: { create: documentRequests.map((d, i) => ({ name: d.name, position: i })) },
      documentDeliveries: { create: documentDeliveries.map((d, i) => ({ name: d.name, position: i })) },
    },
    include: { documentRequests: true, documentDeliveries: true },
  })
}

export async function updateTemplate(id: string, organizationId: string, data: UpdateTemplateBody) {
  const existing = await getTemplateById(id, organizationId)

  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(
    data.periodicity ?? existing.periodicity,
    data.dueDayOfPeriod ?? existing.dueDayOfPeriod,
    data.generationDayOfPeriod ?? existing.generationDayOfPeriod,
  )

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.$transaction(async (tx) => {
    if (documentRequests) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { requestTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentRequests.map((d, i) => ({ requestTemplateId: id, name: d.name, position: i })),
      })
    }
    if (documentDeliveries) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { deliveryTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentDeliveries.map((d, i) => ({ deliveryTemplateId: id, name: d.name, position: i })),
      })
    }
    return tx.recurringTaskTemplate.update({
      where: { id },
      data: templateData,
      include: { documentRequests: true, documentDeliveries: true },
    })
  })
}

export async function deleteTemplate(id: string, organizationId: string) {
  await getTemplateById(id, organizationId)

  const assignmentsCount = await prisma.recurringTaskAssignment.count({ where: { templateId: id } })
  if (assignmentsCount > 0) {
    throw new AppError(409, 'Template em uso — remova os vínculos de cliente antes de excluir')
  }

  await prisma.recurringTaskTemplate.delete({ where: { id } })
  return { ok: true }
}

export async function listAssignments(templateId: string, organizationId: string, search?: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringTaskAssignment.findMany({
    where: {
      templateId,
      ...(search ? { client: { name: { contains: search, mode: 'insensitive' } } } : {}),
    },
    include: { client: { select: { id: true, name: true, codigo: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createAssignment(templateId: string, organizationId: string, data: CreateAssignmentBody) {
  await getTemplateById(templateId, organizationId)
  const client = await prisma.client.findFirst({ where: { id: data.clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const existing = await prisma.recurringTaskAssignment.findFirst({
    where: { templateId, clientId: data.clientId },
  })
  if (existing) throw new AppError(409, 'Este cliente já está vinculado a este template')

  return prisma.recurringTaskAssignment.create({ data: { templateId, clientId: data.clientId } })
}

async function getAssignmentOrThrow(templateId: string, assignmentId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  const assignment = await prisma.recurringTaskAssignment.findFirst({
    where: { id: assignmentId, templateId },
  })
  if (!assignment) throw new AppError(404, 'Vínculo não encontrado')
  return assignment
}

export async function updateAssignment(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  data: UpdateAssignmentBody,
) {
  await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  return prisma.recurringTaskAssignment.update({ where: { id: assignmentId }, data })
}

export async function deleteAssignment(templateId: string, assignmentId: string, organizationId: string) {
  await getAssignmentOrThrow(templateId, assignmentId, organizationId)
  await prisma.recurringTaskAssignment.delete({ where: { id: assignmentId } })
  return { ok: true }
}

export type GenerationOutcome =
  | { status: 'SUCCESS'; taskId: string }
  | { status: 'ALREADY_EXISTS' }
  | { status: 'FAILED'; errorMessage: string }

function isDuplicateGenerationLogError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes('templateId')
  )
}

// Sinaliza que essa execução perdeu a corrida pra outra execução concorrente ao tentar
// reclamar um log FAILED existente (ver comentário no branch `existingLog` abaixo). Deve
// ser tratada exatamente como isDuplicateGenerationLogError — mapeada pra ALREADY_EXISTS,
// nunca cai no branch de "falha genuína" (que reescreveria o log SUCCESS do vencedor pra FAILED).
class ConcurrentGenerationLossError extends Error {}

export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  dueMonth: Date,
): Promise<GenerationOutcome> {
  const template = await prisma.recurringTaskTemplate.findUnique({
    where: { id: templateId },
    include: { documentRequests: true, documentDeliveries: true },
  })
  if (!template) return { status: 'FAILED', errorMessage: 'Template não encontrado' }

  const assignment = await prisma.recurringTaskAssignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.templateId !== templateId) {
    return { status: 'FAILED', errorMessage: 'Vínculo não encontrado' }
  }

  const rules: RecurrenceDateRules = template
  // WEEKLY: dueMonth É a competência (contrato herdado, sem mudança de semântica — ver Task 1).
  // Demais periodicidades: dueMonth é o 1º dia do mês de vencimento; competência é derivada
  // dele (vencimento é a âncora, não mais o contrário).
  const competence = rules.periodicity === 'WEEKLY' ? dueMonth : computeCompetenceFromDueMonth(dueMonth, rules)

  const logKey = {
    templateId_clientId_competence: { templateId, clientId: assignment.clientId, competence },
  }
  const existingLog = await prisma.recurringGenerationLog.findUnique({ where: logKey })
  if (existingLog?.status === 'SUCCESS') return { status: 'ALREADY_EXISTS' }

  try {
    const systemBoard = await ensureRecurringSystemBoard(assignment.clientId, template.organizationId)
    const columnId = systemBoard.columns[0].id

    const dueDate = rules.periodicity === 'WEEKLY' ? computeDueDate(dueMonth, rules) : computeDueDateFromMonth(dueMonth, rules)
    const targetDate = computeTargetDate(dueDate, rules)
    const initialStatus = template.documentRequests.length > 0 ? 'BLOCKED' : 'OPEN'

    const taskId = await prisma.$transaction(async (tx) => {
      const position = await tx.task.count({ where: { columnId } })

      const task = await tx.task.create({
        data: {
          title: template.title,
          description: template.description,
          priority: template.priority,
          status: initialStatus,
          columnId,
          departmentId: template.departmentId,
          competence,
          dueDate,
          targetDate,
          recurringTemplateId: template.id,
          visibleToClient: template.visibleToClient,
          position,
          tags: [],
        },
      })

      if (template.documentRequests.length > 0) {
        await tx.taskDocumentRequirement.createMany({
          data: template.documentRequests.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }
      if (template.documentDeliveries.length > 0) {
        await tx.taskDeliverable.createMany({
          data: template.documentDeliveries.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'created',
          toValue: task.title,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (recorrência)',
        },
      })

      // Tarefa nasce BLOCKED quando o template exige documento — sem essa entrada, a métrica de
      // impedimento nunca enxerga esse período (só veria uma "saída" de BLOCKED quando o cliente
      // enviasse o documento, sem entrada correspondente pra reconstruir o intervalo).
      if (initialStatus === 'BLOCKED') {
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            action: 'status_changed',
            fromValue: 'OPEN',
            toValue: 'BLOCKED',
            actorType: 'system',
            actorId: 'system',
            actorName: 'Sistema (recorrência)',
          },
        })
      }

      // Reserva a chave de idempotência por último, dentro da mesma transação: se outra
      // execução concorrente já reservou essa combinação (templateId, clientId, competence)
      // entre a checagem acima e aqui, o unique constraint derruba a transação inteira —
      // a Task recém-criada é revertida junto, nada fica duplicado no banco.
      if (existingLog) {
        // Quando já existe um log (tipicamente FAILED), não há unique constraint pra colidir
        // num `update` direto — duas transações concorrentes fariam o mesmo update com sucesso
        // e ambas commitariam sua própria Task. Por isso usamos updateMany com o status FAILED
        // ainda na cláusula WHERE: só uma das duas transações consegue affetar a linha (a outra
        // já a encontra SUCCESS, count = 0) — quem perde a corrida trata como ALREADY_EXISTS.
        const claimed = await tx.recurringGenerationLog.updateMany({
          where: { templateId, clientId: assignment.clientId, competence, status: 'FAILED' },
          data: { status: 'SUCCESS', taskId: task.id, errorMessage: null },
        })
        if (claimed.count !== 1) {
          throw new ConcurrentGenerationLossError()
        }
      } else {
        await tx.recurringGenerationLog.create({
          data: { templateId, clientId: assignment.clientId, competence, status: 'SUCCESS', taskId: task.id },
        })
      }

      return task.id
    })

    // Tarefa recorrente pode nascer já BLOCKED (template com documentos exigidos) — não há um
    // "status anterior" real pra uma tarefa recém-criada, mas passar 'OPEN' como anterior sintético
    // é correto pro guard de notifyIfBlocked (previousStatus !== 'BLOCKED'), disparando a notificação
    // exatamente quando initialStatus === 'BLOCKED'. Mesmo raciocínio de isolamento do bloco
    // TASK_CREATED abaixo: a Task e o log SUCCESS já foram commitados, então uma falha só nessa
    // notificação nunca pode cair no catch genérico (que reescreveria o log pra FAILED).
    try {
      await notifyIfBlocked(taskId, 'OPEN', initialStatus, assignment.clientId, template.organizationId, template.visibleToClient)
    } catch (notifyErr) {
      logger.error(
        { err: notifyErr, taskId, templateId, clientId: assignment.clientId },
        'Falha ao enfileirar notificação TASK_BLOCKED — geração da tarefa já foi concluída com sucesso',
      )
    }

    if (template.notifyViaWhatsapp || template.notifyViaEmail) {
      const channels: MessageChannel[] = []
      if (template.notifyViaWhatsapp) channels.push('WHATSAPP')
      if (template.notifyViaEmail) channels.push('EMAIL')
      // Best-effort: a Task e o log SUCCESS já foram commitados na transação acima. Uma falha
      // aqui (ex.: blip de conectividade com o Redis) é só um problema de notificação — nunca
      // pode ser tratada pelo catch genérico abaixo, que reescreveria o log pra FAILED e reabriria
      // a chave de idempotência, permitindo uma segunda Task pra mesma competência na próxima
      // tentativa. Isolada no seu próprio try/catch: loga e segue, geração continua SUCCESS.
      try {
        await enqueueNotification({
          event: 'TASK_CREATED',
          organizationId: template.organizationId,
          clientId: assignment.clientId,
          taskId,
          channels,
          metadata: { taskTitle: template.title },
        })
      } catch (notifyErr) {
        logger.error(
          { err: notifyErr, taskId, templateId, clientId: assignment.clientId },
          'Falha ao enfileirar notificação TASK_CREATED — geração da tarefa já foi concluída com sucesso',
        )
      }
    }

    return { status: 'SUCCESS', taskId }
  } catch (err) {
    if (isDuplicateGenerationLogError(err) || err instanceof ConcurrentGenerationLossError) {
      // Perdeu a corrida pra outra execução concorrente que gerou essa competência primeiro
      // — não é uma falha real, é o próprio mecanismo de idempotência funcionando.
      return { status: 'ALREADY_EXISTS' }
    }

    const errorMessage = err instanceof Error ? err.message : String(err)

    await prisma.recurringGenerationLog.upsert({
      where: logKey,
      create: { templateId, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage },
      update: { status: 'FAILED', errorMessage, taskId: null },
    })

    const admins = await prisma.user.findMany({
      where: { organizationId: template.organizationId, role: 'ORG_ADMIN', isActive: true },
      select: { id: true },
    })
    await Promise.all(
      admins.map((admin) =>
        enqueueNotification({
          event: 'RECURRING_GENERATION_FAILED',
          organizationId: template.organizationId,
          recipientType: 'USER',
          userId: admin.id,
          metadata: { templateTitle: template.title, errorMessage },
        }),
      ),
    )

    return { status: 'FAILED', errorMessage }
  }
}

export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  dueMonthOverride?: string,
) {
  const template = await getTemplateById(templateId, organizationId)
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  const rules: RecurrenceDateRules = template
  // Canonicaliza o override pro início do período a que ele pertence — mesmo raciocínio de
  // idempotência de antes (ver comentário original). Sem override: usa o próximo ciclo normal
  // do template (o que o cron geraria no próximo disparo), não mais "o mês/semana atual cru".
  const dueMonth = dueMonthOverride
    ? normalizeToPeriodStart(new Date(dueMonthOverride), template.periodicity)
    : computeNextDueMonth(new Date(), rules)

  const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

  if (outcome.status === 'ALREADY_EXISTS') {
    throw new AppError(409, 'Já existe tarefa gerada pra essa competência e esse cliente')
  }
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao gerar: ${outcome.errorMessage}`)
  }
  return { taskId: outcome.taskId }
}

export async function listGenerationLog(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringGenerationLog.findMany({
    where: { templateId },
    include: { template: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export interface BulkGenerationResult {
  generated: number
  alreadyExists: number
  failed: { clientName: string; errorMessage: string }[]
}

export async function generateBulkForTemplate(
  templateId: string,
  organizationId: string,
  dueMonthRaw: string,
  assignmentIds: string[],
): Promise<BulkGenerationResult> {
  const template = await getTemplateById(templateId, organizationId)
  const targetMonth = normalizeToPeriodStart(new Date(dueMonthRaw), template.periodicity)
  // WEEKLY: o mês escolhido na tela não é uma única competência — é um mês calendário que
  // pode conter várias semanas (segundas-feiras). Gerar só a semana canonicalizada pelo mês
  // (como as demais periodicidades fazem) deixaria o resto do mês sem tarefa — ver finding 3
  // da revisão final. Demais periodicidades: mantém o comportamento de sempre, uma única
  // competência derivada do mês escolhido.
  const dueMonths = template.periodicity === 'WEEKLY'
    ? computeWeeklyCompetencesInMonth(targetMonth)
    : [targetMonth]

  const assignments = await prisma.recurringTaskAssignment.findMany({
    where: { id: { in: assignmentIds }, templateId },
    include: { client: { select: { name: true } } },
  })
  const foundIds = new Set(assignments.map((a) => a.id))

  const result: BulkGenerationResult = { generated: 0, alreadyExists: 0, failed: [] }

  // IDs que não pertencem a este template/org (removidos entre a seleção na tela e o clique
  // no botão, ou um request forjado) entram em failed[] com motivo explícito — nunca somem
  // silenciosamente, ver spec "Falhas persistentes".
  for (const requestedId of assignmentIds) {
    if (!foundIds.has(requestedId)) {
      result.failed.push({ clientName: '(cliente não encontrado)', errorMessage: 'Cliente não encontrado ou não vinculado a este template' })
    }
  }

  for (const assignment of assignments) {
    for (const dueMonth of dueMonths) {
      // generateTaskForAssignment só protege o trecho pós-checagem de idempotência com try/catch
      // interno — busca de template/assignment, derivação de competência e lookup do log ficam
      // fora dele e podem lançar (ex.: blip transitório de banco). Sem este try/catch aqui, uma
      // exceção num item abortaria a chamada inteira, perdendo o `result` já acumulado dos itens
      // anteriores — contradizendo a regra de que uma falha isolada nunca derruba o lote.
      try {
        const outcome = await generateTaskForAssignment(templateId, assignment.id, dueMonth)
        if (outcome.status === 'SUCCESS') result.generated++
        else if (outcome.status === 'ALREADY_EXISTS') result.alreadyExists++
        else result.failed.push({ clientName: assignment.client.name, errorMessage: outcome.errorMessage })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        result.failed.push({ clientName: assignment.client.name, errorMessage })
      }
    }
  }

  return result
}

export interface BulkGenerationSummary {
  templateId: string
  templateTitle: string
  result: BulkGenerationResult
}

export async function generateBulkForAllTemplates(
  organizationId: string,
  dueMonthRaw: string,
): Promise<BulkGenerationSummary[]> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { organizationId, isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  const summaries: BulkGenerationSummary[] = []
  for (const template of templates) {
    const assignmentIds = template.assignments.map((a) => a.id)
    const result = assignmentIds.length > 0
      ? await generateBulkForTemplate(template.id, organizationId, dueMonthRaw, assignmentIds)
      : { generated: 0, alreadyExists: 0, failed: [] }
    summaries.push({ templateId: template.id, templateTitle: template.title, result })
  }
  return summaries
}

export interface FailedGeneration {
  templateId: string
  templateTitle: string
  clientId: string
  clientName: string
  competence: string
  dueMonth: string
  retryable: boolean
  errorMessage: string
  createdAt: string
}

export async function getFailedGenerations(organizationId: string): Promise<FailedGeneration[]> {
  const logs = await prisma.recurringGenerationLog.findMany({
    where: { status: 'FAILED', template: { organizationId } },
    include: { template: { select: { id: true, title: true, periodicity: true, competenceMonthOffset: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (logs.length === 0) return []

  const clientIds = [...new Set(logs.map((l) => l.clientId))]
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]))

  // Um log só é "retryable" se o cliente ainda está vinculado (ativo) a esse template —
  // senão o retry não teria pra qual assignmentId mandar, e travaria o banner pra sempre
  // (ver finding 4 da revisão final). Uma query batched pra todos os pares, não N+1.
  const activeAssignments = await prisma.recurringTaskAssignment.findMany({
    where: {
      templateId: { in: [...new Set(logs.map((l) => l.templateId))] },
      clientId: { in: clientIds },
      isActive: true,
    },
    select: { templateId: true, clientId: true },
  })
  const retryableKeys = new Set(activeAssignments.map((a) => `${a.templateId}:${a.clientId}`))

  return logs.map((log) => {
    const rules: Pick<RecurrenceDateRules, 'periodicity' | 'competenceMonthOffset'> = log.template
    return {
      templateId: log.template.id,
      templateTitle: log.template.title,
      clientId: log.clientId,
      clientName: clientNameById.get(log.clientId) ?? '(cliente removido)',
      competence: log.competence.toISOString(),
      dueMonth: computeDueMonthFromCompetence(log.competence, rules).toISOString(),
      retryable: retryableKeys.has(`${log.templateId}:${log.clientId}`),
      errorMessage: log.errorMessage ?? '',
      createdAt: log.createdAt.toISOString(),
    }
  })
}

/**
 * Regenera uma tarefa recorrente que nasceu com dados errados (ex: template mal configurado) —
 * apaga a tarefa atual e gera uma nova pra mesma competência, usando a config ATUAL do template
 * (já corrigida). Só permitido se a tarefa não teve nenhuma movimentação real: sem histórico além
 * do "created", sem comentário, sem anexo — "sem movimentação" aqui é literal, qualquer rastro de
 * uso trava a regeneração automática (a correção vira um caso manual, fora deste fluxo).
 *
 * Vive neste módulo (não em tasks.service.ts) pra evitar import circular: este arquivo já importa
 * de tasks.service.ts (ensureRecurringSystemBoard), então o caminho inverso quebraria a resolução
 * de módulos ESM/CJS.
 */
export async function regenerateTask(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    include: { column: { include: { board: { select: { organizationId: true, clientId: true } } } } },
  })
  if (!task || task.column.board.organizationId !== organizationId) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  if (!task.recurringTemplateId) {
    throw new AppError(400, 'Essa tarefa não é recorrente')
  }
  if (!task.competence) {
    throw new AppError(400, 'Tarefa recorrente sem competência registrada — não é possível regenerar')
  }

  const [historyCount, commentCount, attachmentCount] = await Promise.all([
    prisma.taskHistory.count({ where: { taskId, action: { not: 'created' } } }),
    prisma.comment.count({ where: { taskId } }),
    prisma.attachment.count({ where: { taskId } }),
  ])
  if (historyCount > 0 || commentCount > 0 || attachmentCount > 0) {
    throw new AppError(409, 'Essa tarefa já teve movimentação — não pode ser regenerada automaticamente')
  }

  const template = await prisma.recurringTaskTemplate.findUnique({ where: { id: task.recurringTemplateId } })
  if (!template) throw new AppError(404, 'Template de recorrência não encontrado')

  const clientId = task.column.board.clientId
  const assignment = await prisma.recurringTaskAssignment.findFirst({
    where: { templateId: template.id, clientId },
  })
  if (!assignment) {
    throw new AppError(409, 'Cliente não está mais vinculado a esse template — vincule novamente antes de regenerar')
  }

  const dueMonth = computeDueMonthFromCompetence(task.competence, template)

  // Apaga a tarefa e libera a chave de idempotência (templateId, clientId, competence) na mesma
  // transação — se uma das duas falhar, as duas revertem, nunca fica um log liberado sem a tarefa
  // correspondente removida (ou vice-versa).
  await prisma.$transaction([
    prisma.recurringGenerationLog.deleteMany({
      where: { templateId: template.id, clientId, competence: task.competence },
    }),
    prisma.task.delete({ where: { id: taskId } }),
  ])

  const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao regenerar: ${outcome.errorMessage}`)
  }
  if (outcome.status === 'ALREADY_EXISTS') {
    // Corrida rara: outra geração (cron ou outro operador) criou a tarefa pra essa competência
    // entre o delete acima e esta chamada. A tarefa antiga já foi removida de qualquer forma —
    // reportar como falha pro operador conferir o estado atual, não fingir sucesso.
    throw new AppError(409, 'Já existe outra tarefa gerada pra essa competência — confira o board')
  }
  return { taskId: outcome.taskId }
}

export interface BulkRegenerationResult {
  regenerated: number
  failed: { clientName: string; errorMessage: string }[]
}

/**
 * Mesma ideia de generateBulkForTemplate, mas pra regenerateTask — útil quando a mesma tarefa
 * recorrente já foi gerada errada pra muitos clientes de uma vez (ex: template mal configurado
 * desde o início) e corrigir tarefa por tarefa na drawer não escala. Reaproveita regenerateTask
 * pra cada cliente selecionado, resolvendo qual tarefa regenerar a partir do log SUCCESS daquela
 * competência — não do ID da tarefa, que o operador não tem na tela de lote.
 */
export async function regenerateBulkForTemplate(
  templateId: string,
  organizationId: string,
  dueMonthRaw: string,
  assignmentIds: string[],
): Promise<BulkRegenerationResult> {
  const template = await getTemplateById(templateId, organizationId)
  const dueMonth = normalizeToPeriodStart(new Date(dueMonthRaw), template.periodicity)
  const competence = template.periodicity === 'WEEKLY' ? dueMonth : computeCompetenceFromDueMonth(dueMonth, template)

  const assignments = await prisma.recurringTaskAssignment.findMany({
    where: { id: { in: assignmentIds }, templateId },
    include: { client: { select: { id: true, name: true } } },
  })
  const foundIds = new Set(assignments.map((a) => a.id))

  const result: BulkRegenerationResult = { regenerated: 0, failed: [] }

  for (const requestedId of assignmentIds) {
    if (!foundIds.has(requestedId)) {
      result.failed.push({ clientName: '(cliente não encontrado)', errorMessage: 'Cliente não encontrado ou não vinculado a este template' })
    }
  }

  for (const assignment of assignments) {
    try {
      const log = await prisma.recurringGenerationLog.findUnique({
        where: { templateId_clientId_competence: { templateId, clientId: assignment.client.id, competence } },
      })
      if (!log || log.status !== 'SUCCESS' || !log.taskId) {
        result.failed.push({ clientName: assignment.client.name, errorMessage: 'Nenhuma tarefa gerada pra essa competência' })
        continue
      }
      await regenerateTask(log.taskId, organizationId)
      result.regenerated++
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      result.failed.push({ clientName: assignment.client.name, errorMessage })
    }
  }

  return result
}
