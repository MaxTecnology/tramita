// apps/api/src/modules/notifications/notifications.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { getTemplate, renderTemplate, PREVIEW_VARS } from '@/lib/template'
import { uploadFile, deleteFile } from '@/lib/b2'
import type { NotificationEvent, MessageChannel, NotificationStatus } from '@prisma/client'
import type { UpdateConfigBody, UpsertTemplateBody } from './notifications.schema'

function maskToken(token: string): string {
  if (token.length <= 12) return '••••••••'
  return token.slice(0, 10) + '••••••••' + token.slice(-4)
}

export async function getConfig(organizationId: string) {
  const config = await prisma.notificationConfig.findUnique({
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
      slaTargetWarningDays: true,
      slaDueCriticalDays: true,
      slaDigestEnabled: true,
      lateClosureThresholdDays: true,
      customSlaSoundLabel: true,
      requestCreated: true,
      requestApproved: true,
      requestRejected: true,
      taskBlocked: true,
      recurringGenerationFailed: true,
      documentRejected: true,
      saveOnTicket: true,
      startChatbot: true,
      createdAt: true,
      updatedAt: true,
      maximizebotToken: true, // fetched only to produce the masked preview
    },
  })

  if (!config) return null

  const { maximizebotToken, ...rest } = config
  return {
    ...rest,
    maximizebotTokenPreview: maximizebotToken ? maskToken(maximizebotToken) : null,
  }
}

export async function updateConfig(organizationId: string, data: UpdateConfigBody) {
  const toSave = { ...data }
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

export async function testEmail(_organizationId: string, to: string) {
  const { sendEmail } = await import('@/lib/mailer')
  const { wrapEmailHtml } = await import('@/lib/email-template')
  const subject = 'Teste de Email — Tramita'
  const body = 'Este é um email de teste enviado pelo Tramita.\n\nSe você recebeu esta mensagem, a integração de email está funcionando corretamente.'
  await sendEmail(to, subject, body, wrapEmailHtml(subject, body))
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

const SLA_SOUND_MAX_SIZE = 500 * 1024
const SLA_SOUND_ALLOWED_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav'])
const SLA_SOUND_EXTENSION: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}
const SLA_SOUND_LABEL_MAX_LENGTH = 100

export function isAllowedSlaSoundType(mimeType: string): boolean {
  return SLA_SOUND_ALLOWED_TYPES.has(mimeType)
}

export const SLA_SOUND_MAX_SIZE_BYTES = SLA_SOUND_MAX_SIZE

// O Content-Type é declarado pelo cliente e pode ser forjado — confirma a assinatura real dos
// primeiros bytes do arquivo antes de aceitar, como qualquer validação de upload deveria fazer.
export function hasValidAudioSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'audio/mpeg') {
    const isId3 = buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33 // "ID3"
    const isMpegFrameSync = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
    return isId3 || isMpegFrameSync
  }
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE'
    )
  }
  return false
}

export async function uploadSlaSound(
  organizationId: string,
  file: { buffer: Buffer; mimeType: string; label: string },
): Promise<void> {
  const extension = SLA_SOUND_EXTENSION[file.mimeType] ?? 'mp3'
  const key = `sla-sounds/${organizationId}.${extension}`
  const label = file.label.slice(0, SLA_SOUND_LABEL_MAX_LENGTH)
  await uploadFile(key, file.buffer, file.mimeType)
  await prisma.notificationConfig.upsert({
    where: { organizationId },
    create: { organizationId, customSlaSoundKey: key, customSlaSoundLabel: label },
    update: { customSlaSoundKey: key, customSlaSoundLabel: label },
  })
}

export async function deleteSlaSound(organizationId: string): Promise<void> {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.customSlaSoundKey) return
  await deleteFile(config.customSlaSoundKey)
  await prisma.notificationConfig.update({
    where: { organizationId },
    data: { customSlaSoundKey: null, customSlaSoundLabel: null },
  })
}
