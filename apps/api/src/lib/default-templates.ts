// apps/api/src/lib/default-templates.ts
import type { NotificationEvent, MessageChannel } from '@prisma/client'

type TemplateEntry = { subject?: string; body: string }
type TemplateMap = Record<NotificationEvent, Record<MessageChannel, TemplateEntry>>

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
  REQUEST_CREATED: {
    WHATSAPP: { body: 'Nova solicitação de {{clientName}}: *{{requestTitle}}*.' },
    EMAIL: { subject: 'Nova solicitação — {{requestTitle}}', body: 'Olá!\n\nO cliente {{clientName}} abriu uma nova solicitação: *{{requestTitle}}*.\n\nAcesse o painel para avaliar: {{portalUrl}}' },
  },
  REQUEST_APPROVED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Sua solicitação *{{requestTitle}}* foi aprovada e já está em andamento.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Solicitação aprovada — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nSua solicitação *{{requestTitle}}* foi aprovada e já está em andamento.\n\nAcompanhe em: {{portalUrl}}' },
  },
  REQUEST_REJECTED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Sua solicitação *{{requestTitle}}* não foi aprovada.\n\nMotivo: {{rejectionReason}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Solicitação não aprovada — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nSua solicitação *{{requestTitle}}* não foi aprovada.\n\nMotivo: {{rejectionReason}}\n\nAcompanhe em: {{portalUrl}}' },
  },
  RECURRING_GENERATION_FAILED: {
    WHATSAPP: { body: 'Falha ao gerar a tarefa recorrente *{{templateTitle}}*: {{errorMessage}}' },
    EMAIL: { subject: 'Falha na geração de tarefa recorrente — {{templateTitle}}', body: 'A geração automática da tarefa recorrente *{{templateTitle}}* falhou.\n\nMotivo: {{errorMessage}}\n\nAcesse o painel pra reprocessar: {{portalUrl}}' },
  },
  DOCUMENT_REJECTED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! O documento *{{documentName}}* enviado em *{{taskTitle}}* foi rejeitado.\n\nMotivo: {{rejectionReason}}\n\nEnvie novamente: {{portalUrl}}' },
    EMAIL: { subject: 'Documento rejeitado — {{documentName}}', body: 'Olá, {{clientName}}!\n\nO documento *{{documentName}}* enviado em *{{taskTitle}}* foi rejeitado.\n\nMotivo: {{rejectionReason}}\n\nEnvie novamente em: {{portalUrl}}' },
  },
}
