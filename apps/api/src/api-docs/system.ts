import type { RouteDocs } from '@/api-docs/types'
import { logsQuerySchema, previewSchema, testEmailSchema, testWhatsappSchema, updateConfigSchema, upsertTemplateSchema } from '@/modules/notifications/notifications.schema'
import { listNotificationsQuerySchema, readByTaskSchema } from '@/modules/inbox/inbox.schema'
import { productivityQuerySchema } from '@/modules/dashboard/dashboard.schema'
import { anexarOpcoesSchema, confirmarLoteSchema, filaQuerySchema, trocarTarefaBodySchema } from '@/modules/document-reader/document-reader.schema'
import { atualizarModeloSchema, createObligationTypeSchema, criarModeloSchema, verificarColisaoSchema } from '@/modules/document-reader/document-reader-models.schema'

const STREAM = 'Server-Sent Events. Sem header de token: use `?ticket=` obtido em POST /stream/ticket (uso único, 30 s).'

// Notifications (client messages and the in-app bell), real time, dashboards and the document robot
export const SYSTEM_DOCS: RouteDocs = {
  'GET /notifications/config': { summary: 'Configuração de WhatsApp e e-mail do escritório', description: 'Tokens e senhas nunca voltam na resposta.' },
  'PATCH /notifications/config': { summary: 'Alterar configuração de WhatsApp e e-mail', body: updateConfigSchema },
  'POST /notifications/config/test-whatsapp': { summary: 'Enviar WhatsApp de teste', body: testWhatsappSchema },
  'POST /notifications/config/test-email': { summary: 'Enviar e-mail de teste', body: testEmailSchema },
  'POST /notifications/config/sla-sound': { summary: 'Enviar som de alerta de prazo personalizado', upload: {} },
  'DELETE /notifications/config/sla-sound': { summary: 'Voltar ao som de alerta padrão' },
  'POST /notifications/templates/preview': { summary: 'Pré-visualizar mensagem com as variáveis preenchidas', body: previewSchema },
  'GET /notifications/templates/:event/:channel': { summary: 'Mensagem usada no evento e canal', description: 'A personalizada do escritório ou, sem ela, a padrão do sistema.' },
  'PUT /notifications/templates/:event/:channel': { summary: 'Personalizar mensagem do evento e canal', body: upsertTemplateSchema },
  'DELETE /notifications/templates/:event/:channel': { summary: 'Voltar à mensagem padrão' },
  'GET /notifications/logs': { summary: 'Mensagens enviadas aos clientes', querystring: logsQuerySchema },

  'GET /notifications': { summary: 'Avisos do sino', querystring: listNotificationsQuerySchema },
  'GET /notifications/unread-count': { summary: 'Avisos não lidos' },
  'POST /notifications/read-all': { summary: 'Marcar todos os avisos como lidos' },
  'POST /notifications/read-by-task': { summary: 'Marcar como lidos os avisos de uma tarefa', body: readByTaskSchema },
  'POST /notifications/:id/read': { summary: 'Marcar aviso como lido' },
  'POST /notifications/:id/unread': { summary: 'Marcar aviso como não lido' },

  'POST /stream/ticket': { summary: 'Ticket para abrir um canal em tempo real', description: 'O `EventSource` do navegador não manda header; o ticket vai na URL do canal.' },
  'GET /notifications/stream': { summary: 'Avisos do sino em tempo real', description: STREAM },
  'GET /boards/:id/stream': { summary: 'Mudanças no processo em tempo real', description: `${STREAM} O cliente recebe só o aviso de que algo mudou, sem o conteúdo.` },
  'GET /requests/stream': { summary: 'Novas solicitações em tempo real', description: STREAM },

  'GET /dashboard/metrics': { summary: 'Números do painel: tarefas abertas, atrasadas, concluídas' },
  'GET /dashboard/team-members': { summary: 'Pessoas para filtrar o painel' },
  'GET /dashboard/productivity': { summary: 'Produtividade da equipe no período', querystring: productivityQuerySchema },

  'POST /document-reader/upload': { summary: 'Enviar documentos para o robô ler', description: 'O robô identifica cliente, obrigação e competência e sugere a tarefa.', upload: {} },
  'GET /document-reader/fila': { summary: 'Fila de revisão do robô', querystring: filaQuerySchema },
  'GET /document-reader/:id/visualizar': { summary: 'Link para ver o documento lido' },
  'GET /document-reader/rejeitados': { summary: 'Documentos rejeitados' },
  'GET /document-reader/obrigacoes': { summary: 'Tipos de obrigação que o robô reconhece' },
  'POST /document-reader/obrigacoes': { summary: 'Cadastrar tipo de obrigação', body: createObligationTypeSchema },
  'GET /document-reader/metricas': { summary: 'Métricas do robô de documentos' },
  'POST /document-reader/confirmar-lote': { summary: 'Confirmar várias sugestões do robô', body: confirmarLoteSchema },
  'POST /document-reader/:id/confirmar': { summary: 'Confirmar sugestão: anexar o documento à tarefa', body: anexarOpcoesSchema },
  'POST /document-reader/:id/trocar-tarefa': { summary: 'Escolher outra tarefa para o documento', body: trocarTarefaBodySchema },
  'POST /document-reader/:id/rejeitar': { summary: 'Rejeitar documento' },
  'POST /document-reader/:id/reabrir': { summary: 'Devolver documento rejeitado à fila' },
  'POST /document-reader/modelos/analisar': { summary: 'Ler um PDF de exemplo para montar um modelo', upload: {} },
  'GET /document-reader/modelos': { summary: 'Modelos de leitura' },
  'POST /document-reader/modelos/verificar-colisao': { summary: 'Verificar se o modelo conflita com outro', body: verificarColisaoSchema },
  'POST /document-reader/modelos': { summary: 'Criar modelo de leitura', body: criarModeloSchema },
  'PATCH /document-reader/modelos/:id': { summary: 'Alterar modelo de leitura', body: atualizarModeloSchema },
  'DELETE /document-reader/modelos/:id': { summary: 'Arquivar modelo de leitura' },
}
