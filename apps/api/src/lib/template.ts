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
  documentName?: string      // novo — nome do documento rejeitado (DOCUMENT_REJECTED)
  templateTitle?: string     // novo — título do template de recorrência (RECURRING_GENERATION_FAILED)
  errorMessage?: string      // novo — mensagem de erro da geração (RECURRING_GENERATION_FAILED)
  taskCount?: string       // novo — quantidade total de tarefas em alerta (SLA_DIGEST)
  criticalCount?: string   // novo — quantidade em nível crítico (SLA_DIGEST)
  taskListText?: string    // novo — lista formatada em texto simples, uma tarefa por linha (SLA_DIGEST)
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
  documentName: 'Extrato bancário',
  templateTitle: 'Folha de pagamento',
  errorMessage: 'Coluna do processo não encontrada',
  taskCount: '3',
  criticalCount: '1',
  taskListText: '- Abertura de LTDA (João Silva) — vence 20/10/2026 [crítico]\n- Folha de pagamento (Maria Souza) — meta 25/10/2026 [atenção]',
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
