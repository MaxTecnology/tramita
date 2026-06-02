// apps/api/src/lib/default-templates.ts
import type { NotificationEvent, MessageChannel } from '@prisma/client'

type TemplateEntry = { subject?: string; body: string }
type TemplateMap = Record<NotificationEvent, Partial<Record<MessageChannel, TemplateEntry>>>

export const DEFAULT_TEMPLATES: TemplateMap = {
  TASK_CREATED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Um novo processo *{{taskTitle}}* foi aberto para você.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo processo — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nUm novo processo foi aberto: *{{taskTitle}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_MOVED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Atualização — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMPLETED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* foi concluído!\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Processo concluído — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* foi concluído com sucesso!\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMMENT_ADDED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Novo comentário em *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo comentário — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nNovo comentário em *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_DUE_DATE_APPROACHING: {
    WHATSAPP: { body: 'Olá, {{clientName}}! O processo *{{taskTitle}}* vence em {{dueDate}}. Acesse: {{portalUrl}}' },
    EMAIL: { subject: 'Prazo se aproximando — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nO processo *{{taskTitle}}* vence em {{dueDate}}.\n\nAcompanhe em: {{portalUrl}}' },
  },
}
