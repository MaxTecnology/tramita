// apps/api/src/workers/notification.worker.ts
import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { renderTemplate, getTemplate } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import { decrypt } from '@/lib/encryption'
import type { NotificationConfig, NotificationEvent, MessageChannel } from '@prisma/client'
import type { NotificationJob } from '@/lib/queue'

const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
}

export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, taskId, organizationId, clientId, metadata } = job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled) return

  const [client, task, org] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.task.findUnique({ where: { id: taskId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!client || !task || !org) return

  const vars = {
    clientName: client.name,
    orgName: org.name,
    taskTitle: task.title,
    fromColumn: metadata.fromColumn,
    toColumn: metadata.toColumn,
    dueDate: metadata.dueDate,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/portal`,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
  }

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled && config.smtpHost && config.smtpPass) channels.push('EMAIL')

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
        const pass = decrypt(config.smtpPass!)
        await sendEmail(
          {
            host: config.smtpHost!,
            port: config.smtpPort!,
            user: config.smtpUser!,
            pass,
            from: config.emailFrom!,
          },
          client.email,
          renderTemplate(template.subject ?? '', vars),
          rendered,
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
        recipient: channel === 'WHATSAPP' ? client.whatsapp! : client.email,
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
    connection: redis,
    concurrency: 5,
  })
}
