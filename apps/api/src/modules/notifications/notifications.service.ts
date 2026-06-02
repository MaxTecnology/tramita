// apps/api/src/modules/notifications/notifications.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { encrypt, decrypt } from '@/lib/encryption'
import { getTemplate, renderTemplate, PREVIEW_VARS } from '@/lib/template'
import type { NotificationEvent, MessageChannel, NotificationStatus } from '@prisma/client'
import type { UpdateConfigBody, UpsertTemplateBody } from './notifications.schema'

export async function getConfig(organizationId: string) {
  return prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: {
      id: true,
      organizationId: true,
      whatsappEnabled: true,
      emailEnabled: true,
      taskCreated: true,
      taskMoved: true,
      taskCompleted: true,
      commentAdded: true,
      dueDateAlert: true,
      saveOnTicket: true,
      startChatbot: true,
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      emailFrom: true,
      createdAt: true,
      updatedAt: true,
      // smtpPass e maximizebotToken propositalmente omitidos
    },
  })
}

export async function updateConfig(organizationId: string, data: UpdateConfigBody) {
  const toSave = { ...data }
  if (toSave.smtpPass) toSave.smtpPass = encrypt(toSave.smtpPass)
  return prisma.notificationConfig.upsert({
    where: { organizationId },
    create: { organizationId, ...toSave },
    update: toSave,
  })
}

export async function listTemplates(organizationId: string) {
  return prisma.messageTemplate.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ event: 'asc' }, { channel: 'asc' }],
  })
}

export async function getTemplateForOrg(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
) {
  const custom = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  const template = await getTemplate(organizationId, event, channel)
  return { ...template, isDefault: !custom }
}

export async function upsertTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
  data: UpsertTemplateBody,
) {
  return prisma.messageTemplate.upsert({
    where: { organizationId_event_channel: { organizationId, event, channel } },
    create: { organizationId, event, channel, ...data },
    update: data,
  })
}

export async function deleteTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
) {
  const template = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  if (!template) throw new AppError(404, 'Template não encontrado')
  await prisma.messageTemplate.delete({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  return { ok: true }
}

export async function previewTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
  body?: string,
) {
  const templateBody = body ?? (await getTemplate(organizationId, event, channel)).body
  return { rendered: renderTemplate(templateBody, PREVIEW_VARS) }
}

export async function testWhatsApp(organizationId: string, number: string) {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.maximizebotToken) throw new AppError(422, 'MaximizeBot não configurado')
  const { sendWhatsApp } = await import('@/lib/maximizebot')
  await sendWhatsApp(config.maximizebotToken, {
    number,
    body: 'Teste de integração MaximizeBot — Tramita AutoHubs',
    saveOnTicket: false,
  })
  return { ok: true }
}

export async function testEmail(organizationId: string, to: string) {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPass || !config.emailFrom) {
    throw new AppError(422, 'SMTP não configurado completamente')
  }
  const pass = decrypt(config.smtpPass)
  const { sendEmail } = await import('@/lib/mailer')
  await sendEmail(
    { host: config.smtpHost, port: config.smtpPort!, user: config.smtpUser!, pass, from: config.emailFrom! },
    to,
    'Teste de Email — Tramita AutoHubs',
    'Este é um email de teste enviado pelo Tramita.',
  )
  return { ok: true }
}

export async function listLogs(
  organizationId: string,
  filters: { page: number; limit: number; status?: NotificationStatus; channel?: MessageChannel },
) {
  const skip = (filters.page - 1) * filters.limit
  return prisma.notificationLog.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: filters.limit,
  })
}
