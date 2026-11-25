import type { RouteDocs } from '@/api-docs/types'
import { clientBodySchema } from '@/modules/clients/clients.schema'
import { listMunicipalitiesQuerySchema } from '@/modules/municipalities/municipalities.schema'
import { documentRequestsQuerySchema, markPaidSchema, portalClientQuerySchema, portalProtocolsQuerySchema } from '@/modules/portal/portal.schema'
import { approveSchema, requestChangesSchema } from '@/modules/approvals/approvals.schema'
import {
  approveRequestSchema, cancelApprovedRequestSchema, createRequestSchema, listRequestsQuerySchema, needsInfoRequestSchema, rejectRequestSchema,
} from '@/modules/requests/requests.schema'
import { createRequestCommentSchema } from '@/modules/request-comments/request-comments.schema'
import {
  cancelProtocolSchema, createProtocolSchema, listProtocolsQuerySchema, unpaidGuidesQuerySchema, updateProtocolPaymentSchema,
} from '@/modules/protocols/protocols.schema'

// The office's clients, the client portal, service requests and protocols (guides and receipts)
export const CLIENT_DOCS: RouteDocs = {
  'GET /clients': { summary: 'Listar clientes do escritório' },
  'GET /clients/lookup-cnpj/:cnpj': { summary: 'Buscar dados da empresa pelo CNPJ', description: 'Preenche razão social e endereço no cadastro, com estado e cidade (código IBGE). Consulta a BrasilAPI e, se ela estiver fora, o CNPJ.ws. `ibgeCityCode: null` quando a cidade não foi reconhecida — escolher à mão. 502 quando os dois serviços estão fora.' },
  'GET /clients/search-users': { summary: 'Buscar usuários do portal para vincular ao cliente' },
  'POST /clients': { summary: 'Cadastrar cliente', description: 'Respeita o limite de clientes do plano.', body: clientBodySchema },
  'PATCH /clients/:id': { summary: 'Alterar cliente', body: clientBodySchema },
  'DELETE /clients/:id': { summary: 'Desativar cliente', description: 'Sai das listas e o portal dele é bloqueado; o histórico continua.' },
  'POST /clients/:id/reactivate': { summary: 'Reativar cliente', description: 'Volta a ficar ativo. Conta no limite de clientes do plano (422 se atingido).' },
  'GET /clients/:id/users': { summary: 'Usuários do portal ligados ao cliente' },
  'GET /clients/:id/assignments': { summary: 'Departamentos que atendem o cliente e seus responsáveis' },

  'GET /municipalities': { summary: 'Cidades de um estado (IBGE)', description: 'Código IBGE e nome, em ordem alfabética. Usado no cadastro do cliente e nas exceções de vencimento.', querystring: listMunicipalitiesQuerySchema },

  'GET /portal/clients': { summary: 'Empresas que posso acompanhar', description: 'Portal: um usuário pode acompanhar mais de uma empresa.' },
  'GET /portal/home': { summary: 'Início do portal', description: 'Pendências, processos em andamento e guias a pagar da empresa escolhida.', querystring: portalClientQuerySchema },
  'GET /portal/departments': { summary: 'Departamentos que posso acompanhar' },
  'GET /portal/tasks/:taskId/history': { summary: 'Andamento da tarefa (versão do cliente)', description: 'Só os eventos que fazem sentido para o cliente.' },
  'GET /portal/tasks/:taskId/documents': { summary: 'Documentos pedidos e entregues na tarefa' },
  'POST /portal/tasks/:taskId/documents/requests/:reqId/upload': { summary: 'Enviar documento pedido pelo escritório', upload: {} },
  'POST /portal/tasks/:taskId/documents/requests/:reqId/not-applicable': { summary: 'Avisar que o documento pedido não se aplica' },
  'DELETE /portal/tasks/:taskId/documents/requests/:reqId/not-applicable': { summary: 'Desfazer o "não se aplica"' },
  'GET /portal/document-requests/months': { summary: 'Meses com documentos pedidos', querystring: portalClientQuerySchema },
  'GET /portal/document-requests': { summary: 'Documentos pedidos no mês ("Enviar documentos")', querystring: documentRequestsQuerySchema },
  'GET /portal/services': { summary: 'Serviços que posso solicitar' },
  'POST /portal/requests': { summary: 'Solicitar serviço ao escritório', body: createRequestSchema },
  'GET /portal/requests': { summary: 'Minhas solicitações' },
  'GET /portal/requests/:id': { summary: 'Detalhe da solicitação' },
  'PATCH /portal/requests/:id/cancel': { summary: 'Cancelar solicitação ainda não analisada' },
  'POST /portal/requests/:id/attachments': { summary: 'Anexar arquivo à solicitação', upload: {} },
  'GET /portal/protocols': { summary: 'Guias e protocolos da empresa', querystring: portalProtocolsQuerySchema },
  'GET /portal/protocols/:id': { summary: 'Abrir protocolo', description: 'Registra que o cliente visualizou.' },
  'GET /portal/protocols/:id/download': { summary: 'Baixar arquivo do protocolo', description: 'Registra o download e devolve um link temporário.' },
  'POST /portal/protocols/:id/pay': { summary: 'Informar pagamento da guia', description: 'JSON `{ amount }`, ou multipart com `amount` antes do comprovante (opcional).', body: markPaidSchema },
  'DELETE /portal/protocols/:id/pay': { summary: 'Desfazer o pagamento informado' },
  'POST /portal/approvals/:id/approve': { summary: 'Aprovar o que o escritório enviou', body: approveSchema },
  'POST /portal/approvals/:id/request-changes': { summary: 'Pedir ajuste no que o escritório enviou', body: requestChangesSchema },

  'GET /requests': { summary: 'Solicitações dos clientes', querystring: listRequestsQuerySchema },
  'GET /requests/pending-count': { summary: 'Quantas solicitações aguardam análise' },
  'GET /requests/:id': { summary: 'Detalhe da solicitação' },
  'POST /requests/:id/approve': { summary: 'Aceitar solicitação', description: 'Abre o processo ou a OS do serviço pedido.', body: approveRequestSchema },
  'POST /requests/:id/reject': { summary: 'Recusar solicitação', body: rejectRequestSchema },
  'POST /requests/:id/needs-info': { summary: 'Pedir mais informações ao cliente', body: needsInfoRequestSchema },
  'POST /requests/:id/cancel': { summary: 'Cancelar solicitação já aceita', body: cancelApprovedRequestSchema },
  'GET /requests/:requestId/comments': { summary: 'Conversa da solicitação' },
  'POST /requests/:requestId/comments': { summary: 'Escrever na conversa da solicitação', body: createRequestCommentSchema },
  'DELETE /request-comments/:id': { summary: 'Apagar mensagem da solicitação' },

  'POST /tasks/:taskId/protocols': { summary: 'Registrar protocolo na tarefa', description: 'Guia, recibo ou comprovante entregue ao cliente, a partir de um anexo da tarefa.', body: createProtocolSchema },
  'GET /tasks/:taskId/protocols': { summary: 'Protocolos da tarefa' },
  'GET /protocols/summary': { summary: 'Resumo dos protocolos: vistos, baixados, pendentes' },
  'GET /protocols/unpaid/summary': { summary: 'Resumo das guias não pagas' },
  'GET /protocols/unpaid': { summary: 'Guias não pagas', querystring: unpaidGuidesQuerySchema },
  'GET /protocols': { summary: 'Listar protocolos', querystring: listProtocolsQuerySchema },
  'GET /protocols/:id': { summary: 'Detalhe do protocolo' },
  'POST /protocols/:id/replace': { summary: 'Trocar o arquivo do protocolo', upload: {} },
  'PATCH /protocols/:id/payment': { summary: 'Atualizar pagamento da guia', body: updateProtocolPaymentSchema },
  'POST /protocols/:id/cancel': { summary: 'Cancelar protocolo', body: cancelProtocolSchema },
  'GET /protocols/:id/receipt': { summary: 'Recibo do protocolo em PDF' },
}
