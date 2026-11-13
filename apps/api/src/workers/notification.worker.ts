// apps/api/src/workers/notification.worker.ts
import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { renderTemplate, getTemplate, type TemplateVars } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import { wrapEmailHtml } from '@/lib/email-template'
import type { NotificationConfig, NotificationEvent, MessageChannel } from '@prisma/client'
import type { NotificationJob } from '@/lib/queue'
import { resolveClientRecipients, type ClientRecipient } from '@/modules/notifications/client-recipients'

const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_BLOCKED: 'taskBlocked',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
  RECURRING_GENERATION_FAILED: 'recurringGenerationFailed',
  DOCUMENT_REJECTED: 'documentRejected',
  SLA_DIGEST: 'slaDigestEnabled',
  REQUEST_NEEDS_INFO: 'requestNeedsInfo',
  REQUEST_COMMENT_ADDED: 'requestCommentAdded',
  REQUEST_CANCELLED: 'requestCancelled',
  PROTOCOL_CREATED: 'protocolCreated',
  TASK_ASSUMED: 'taskAssumed',
}

export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, organizationId, recipientType = 'CLIENT', clientId, userId, taskId, requestId, metadata, channels, forceChannels } =
    job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  // forceChannels (Column.notifyClient via Template de OS) bypassa o toggle global do evento —
  // é uma escolha explícita por coluna, não o aviso genérico de qualquer movimentação. Outras
  // configurações da org (token do WhatsApp, master switches whatsappEnabled/emailEnabled) ainda
  // se aplicam — só o gate por evento (config.taskMoved etc) é ignorado.
  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled && !forceChannels) return

  if (recipientType === 'USER') {
    if (!userId) return
    await processUserNotification(config, { event, organizationId, userId, taskId, requestId, metadata, channels })
    return
  }

  if (!clientId) return
  await processClientNotification(config, {
    event,
    organizationId,
    clientId,
    taskId,
    requestId,
    metadata,
    channels: forceChannels ?? channels,
  })
}

async function processClientNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    clientId: string
    taskId?: string
    requestId?: string
    metadata: Record<string, string | undefined>
    channels?: MessageChannel[]
  },
): Promise<void> {
  const { event, organizationId, clientId, taskId, requestId, metadata, channels: channelOverride } = params

  const [client, org, task, request] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    taskId
      ? prisma.task.findUnique({
          where: { id: taskId },
          include: { column: { include: { board: { select: { organizationId: true } } } } },
        })
      : Promise.resolve(null),
    requestId
      ? prisma.request.findUnique({ where: { id: requestId }, select: { organizationId: true, departmentId: true } })
      : Promise.resolve(null),
  ])
  if (!client || !org) return
  if (client.organizationId !== organizationId) return
  if (taskId && (!task || task.column.board.organizationId !== organizationId)) return
  if (requestId && (!request || request.organizationId !== organizationId)) return

  // Uma notificação ligada a uma tarefa marcada como controle interno (visibleToClient=false) nunca
  // pode chegar ao cliente por nenhum canal — ele seria mandado ao portal por algo que não consegue ver.
  if (task && !task.visibleToClient) return

  const vars: TemplateVars = {
    clientName: client.name,
    orgName: org.name,
    taskTitle: task?.title,
    requestTitle: metadata.requestTitle,
    rejectionReason: metadata.rejectionReason,
    fromColumn: metadata.fromColumn,
    toColumn: metadata.toColumn,
    dueDate: metadata.dueDate,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/portal`,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
    protocolTitle: metadata.protocolTitle,
    paymentInfo: metadata.paymentInfo,
  }

  // Destinatário por departamento do assunto (tarefa ou solicitação), nos dois canais. O número da
  // empresa (client.whatsapp) não é destino: um assunto da Folha não pode cair no WhatsApp de quem só
  // cuida do Fiscal. Evento sem tarefa nem solicitação não tem departamento: não envia nada (padrão
  // seguro) e avisa no log — um evento novo desse tipo precisa declarar o departamento.
  const departmentId = task?.departmentId ?? request?.departmentId ?? null
  if (!departmentId) {
    logger.warn({ event, organizationId, clientId }, 'Notificação ao cliente sem tarefa nem solicitação — sem departamento, nada enviado')
    return
  }
  const recipients: ClientRecipient[] = await resolveClientRecipients(clientId, departmentId)

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled) channels.push('EMAIL')

  const effectiveChannels = channelOverride ? channels.filter((c) => channelOverride.includes(c)) : channels

  for (const channel of effectiveChannels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)
    const subject = renderTemplate(template.subject ?? '', vars)

    const sentTo = new Set<string>()
    for (const recipient of recipients) {
      const address = channel === 'EMAIL' ? recipient.email : recipient.phone
      // Dois usuários com o mesmo telefone (ex.: número do escritório do cliente) recebem uma vez só.
      if (!address || sentTo.has(address)) continue
      sentTo.add(address)

      // Declarados por destinatário pra que a falha de um nunca vaze pro log do próximo.
      let status: 'SENT' | 'FAILED' = 'SENT'
      let error: string | undefined
      try {
        if (channel === 'EMAIL') {
          await sendEmail(address, subject, rendered, wrapEmailHtml(subject, rendered, vars.portalUrl, 'Acessar portal'))
        } else {
          await sendWhatsApp(config.maximizebotToken!, {
            number: address,
            body: rendered,
            saveOnTicket: config.saveOnTicket,
            startChatbot: config.startChatbot,
            linkPreview: true,
          })
        }
      } catch (err) {
        status = 'FAILED'
        error = err instanceof Error ? err.message : String(err)
        // Recipient (phone/e-mail) stays out of the app log — it is in notification_logs.
        logger.warn({ organizationId, clientId, taskId, requestId, event, channel, reason: error }, 'Falha ao enviar notificação')
      }

      await prisma.notificationLog.create({
        data: {
          organizationId, clientId, event: event as NotificationEvent, channel, taskId, requestId,
          recipient: address, message: rendered, status, error,
          sentAt: status === 'SENT' ? new Date() : undefined,
        },
      })
    }
  }
}

async function processUserNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    userId: string
    taskId?: string
    requestId?: string
    metadata: Record<string, string | undefined>
    channels?: MessageChannel[]
  },
): Promise<void> {
  const { event, organizationId, userId, taskId, requestId, metadata, channels: channelOverride } = params

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!user || !org || user.organizationId !== organizationId) return
  // Usuário desativado (ex-funcionário) nunca pode continuar recebendo notificações — mesmo que
  // ainda esteja como assignee de tasks antigas (desatribuir é responsabilidade de outro fluxo).
  if (!user.isActive) return

  const appUrl = process.env.APP_URL ?? 'https://tramita.autohubs.com.br'
  const vars: TemplateVars = {
    clientName: metadata.clientName ?? '',
    orgName: org.name,
    taskTitle: metadata.taskTitle,
    requestTitle: metadata.requestTitle,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
    taskCount: metadata.taskCount,
    criticalCount: metadata.criticalCount,
    taskListText: metadata.taskListText,
    assumedByName: metadata.assumedByName,
    portalUrl: event === 'TASK_COMMENT_ADDED' || event === 'TASK_ASSUMED' ? `${appUrl}/app` : event === 'SLA_DIGEST' ? `${appUrl}/app` : `${appUrl}/app/requests`,
  }

  const availableChannels: MessageChannel[] = []
  if (config.emailEnabled) availableChannels.push('EMAIL')
  // WHATSAPP pra notificação USER é opt-in por evento — só SLA_DIGEST foi desenhado pra esse
  // canal. Sem essa trava, TASK_COMMENT_ADDED/REQUEST_CREATED/etc (eventos já existentes, que
  // sempre foram só EMAIL) passariam a mandar WhatsApp pra equipe interna assim que a org
  // configurasse o MaximizeBot — uma mudança de comportamento silenciosa fora do escopo deles.
  if (event === 'SLA_DIGEST' && config.whatsappEnabled && config.maximizebotToken && user.phone) {
    availableChannels.push('WHATSAPP')
  }
  const effectiveChannels = channelOverride ? availableChannels.filter((c) => channelOverride.includes(c)) : availableChannels

  for (const channel of effectiveChannels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)

    let status: 'SENT' | 'FAILED' = 'SENT'
    let error: string | undefined
    let recipient: string

    try {
      if (channel === 'EMAIL') {
        recipient = user.email
        const subject = renderTemplate(template.subject ?? '', vars)
        await sendEmail(user.email, subject, rendered, wrapEmailHtml(subject, rendered, vars.portalUrl, 'Ver no painel'))
      } else {
        recipient = user.phone!
        await sendWhatsApp(config.maximizebotToken!, {
          number: user.phone!,
          body: rendered,
          saveOnTicket: config.saveOnTicket,
          startChatbot: config.startChatbot,
          linkPreview: true,
        })
      }
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
      recipient = channel === 'EMAIL' ? user.email : (user.phone ?? '')
      logger.warn({ organizationId, userId: user.id, event, channel, reason: error }, 'Falha ao enviar notificação')
    }

    await prisma.notificationLog.create({
      data: {
        organizationId,
        event: event as NotificationEvent,
        channel,
        taskId,
        requestId,
        recipient,
        message: rendered,
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
}

export function startNotificationWorker() {
  return new Worker('notification-queue', processNotificationJob, {
    connection: bullmqRedis,
    concurrency: 5,
  })
}
