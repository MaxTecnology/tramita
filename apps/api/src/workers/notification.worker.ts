// apps/api/src/workers/notification.worker.ts
import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { renderTemplate, getTemplate, type TemplateVars } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import { wrapEmailHtml } from '@/lib/email-template'
import type { NotificationConfig, NotificationEvent, MessageChannel } from '@prisma/client'
import type { NotificationJob } from '@/lib/queue'

const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
}

export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, organizationId, recipientType = 'CLIENT', clientId, userId, taskId, requestId, metadata } =
    job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled) return

  if (recipientType === 'USER') {
    if (!userId) return
    await processUserNotification(config, { event, organizationId, userId, requestId, metadata })
    return
  }

  if (!clientId) return
  await processClientNotification(config, { event, organizationId, clientId, taskId, requestId, metadata })
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
  },
): Promise<void> {
  const { event, organizationId, clientId, taskId, requestId, metadata } = params

  const [client, org, task] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    taskId
      ? prisma.task.findUnique({
          where: { id: taskId },
          include: { column: { include: { board: { select: { organizationId: true } } } } },
        })
      : Promise.resolve(null),
  ])
  if (!client || !org) return
  if (client.organizationId !== organizationId) return
  if (taskId && (!task || task.column.board.organizationId !== organizationId)) return

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
  }

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled) channels.push('EMAIL')

  for (const channel of channels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)

    let status: 'SENT' | 'FAILED' = 'SENT'
    let error: string | undefined

    try {
      if (channel === 'WHATSAPP') {
        await sendWhatsApp(config.maximizebotToken!, {
          number: client.whatsapp!,
          body: rendered,
          saveOnTicket: config.saveOnTicket,
          startChatbot: config.startChatbot,
          linkPreview: true,
        })
      } else {
        const subject = renderTemplate(template.subject ?? '', vars)
        await sendEmail(
          client.email,
          subject,
          rendered,
          wrapEmailHtml(subject, rendered, vars.portalUrl, 'Acessar portal'),
        )
      }
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
    }

    await prisma.notificationLog.create({
      data: {
        organizationId,
        clientId,
        event: event as NotificationEvent,
        channel,
        taskId,
        requestId,
        recipient: channel === 'WHATSAPP' ? client.whatsapp! : client.email,
        message: rendered,
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
}

async function processUserNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    userId: string
    requestId?: string
    metadata: Record<string, string | undefined>
  },
): Promise<void> {
  const { event, organizationId, userId, requestId, metadata } = params

  if (!config.emailEnabled) return

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!user || !org || user.organizationId !== organizationId) return

  const vars: TemplateVars = {
    clientName: metadata.clientName ?? '',
    orgName: org.name,
    requestTitle: metadata.requestTitle,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/app/requests`,
  }

  const template = await getTemplate(organizationId, event as NotificationEvent, 'EMAIL')
  const rendered = renderTemplate(template.body, vars)

  let status: 'SENT' | 'FAILED' = 'SENT'
  let error: string | undefined

  try {
    const subject = renderTemplate(template.subject ?? '', vars)
    await sendEmail(
      user.email,
      subject,
      rendered,
      wrapEmailHtml(subject, rendered, vars.portalUrl, 'Ver solicitação'),
    )
  } catch (err) {
    status = 'FAILED'
    error = err instanceof Error ? err.message : String(err)
  }

  await prisma.notificationLog.create({
    data: {
      organizationId,
      event: event as NotificationEvent,
      channel: 'EMAIL',
      requestId,
      recipient: user.email,
      message: rendered,
      status,
      error,
      sentAt: status === 'SENT' ? new Date() : undefined,
    },
  })
}

export function startNotificationWorker() {
  return new Worker('notification-queue', processNotificationJob, {
    connection: bullmqRedis,
    concurrency: 5,
  })
}
