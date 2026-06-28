// apps/api/src/lib/template.ts
import type { NotificationEvent, MessageChannel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'

export interface TemplateVars {
  clientName: string
  orgName: string
  taskTitle?: string
  requestTitle?: string
  rejectionReason?: string
  fromColumn?: string
  toColumn?: string
  dueDate?: string
  portalUrl: string
  commentText?: string
  commentAuthorName?: string
}

export const PREVIEW_VARS: TemplateVars = {
  clientName: 'João Silva',
  orgName: 'Escritório G2A',
  taskTitle: 'Abertura de LTDA',
  fromColumn: 'Documentação Pendente',
  toColumn: 'Em Revisão',
  dueDate: '30/06/2026',
  portalUrl: 'https://tramita.autohubs.com.br/portal',
  commentText: 'Documento recebido, obrigado!',
  commentAuthorName: 'Dr. Carlos Mendes',
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof TemplateVars] ?? '')
}

export async function getTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
): Promise<{ body: string; subject?: string | null }> {
  const custom = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  return custom ?? DEFAULT_TEMPLATES[event][channel]
}
