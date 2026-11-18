import type { RouteDocs } from '@/api-docs/types'
import { createBoardSchema, listBoardsQuerySchema, searchQuerySchema, updateBoardSchema } from '@/modules/boards/boards.schema'
import { assumeBulkSchema, assumeTaskSchema, createTaskSchema, listTasksQuerySchema, moveTaskSchema, updateTaskSchema } from '@/modules/tasks/tasks.schema'
import { createCommentSchema } from '@/modules/comments/comments.schema'
import { addOSToProcessSchema, listOSQuerySchema, openOSSchema, osDashboardQuerySchema, releaseEarlySchema } from '@/modules/os/os.schema'
import { createOSModelSchema, listOSModelsQuerySchema, updateOSModelSchema } from '@/modules/os-models/os-models.schema'
import { createProcessTemplateSchema, updateProcessTemplateSchema } from '@/modules/process-templates/process-templates.schema'
import { createDelayReasonSchema, setDelayReasonSchema, updateDelayReasonSchema } from '@/modules/delay-reasons/delay-reasons.schema'
import {
  bulkGenerateAllSchema, bulkGenerateSchema, bulkRegenerateSchema, createAssignmentSchema, createTemplateSchema, updateAssignmentSchema, updateTemplateSchema,
} from '@/modules/recurring-templates/recurring-templates.schema'
import { createHolidaySchema, holidayDaysQuerySchema, listHolidaysQuerySchema } from '@/modules/holidays/holidays.schema'
import { createDepartmentSchema, listDepartmentsQuerySchema, updateDepartmentSchema } from '@/modules/departments/departments.schema'
import { closeApprovalSchema } from '@/modules/approvals/approvals.schema'
import { addDeliverableSchema, addDocumentItemSchema, reviewDocumentRequirementSchema } from '@/modules/task-documents/task-documents.schema'

// The office's work: processes (boards), service orders, tasks and what configures them
export const WORK_DOCS: RouteDocs = {
  'GET /boards': { summary: 'Listar processos', description: 'A equipe vê os do seu escopo; o cliente, os dos clientes e departamentos a que tem acesso.', querystring: listBoardsQuerySchema },
  'GET /boards/:id': { summary: 'Processo com colunas e tarefas' },
  'GET /boards/:id/tasks/search': { summary: 'Buscar tarefas no processo', querystring: searchQuerySchema },
  'POST /boards': { summary: 'Abrir processo', description: 'A partir de um modelo de processo: cria as colunas e as OS do modelo para o cliente.', body: createBoardSchema },
  'PATCH /boards/:id': { summary: 'Alterar processo', body: updateBoardSchema },
  'GET /boards/:id/stage-times': { summary: 'Tempo gasto em cada etapa do processo' },
  'POST /boards/:id/os': { summary: 'Incluir OS em processo aberto', body: addOSToProcessSchema },
  'PATCH /boards/:id/delay-reason': { summary: 'Informar motivo de atraso do processo', body: setDelayReasonSchema },

  'POST /columns/:columnId/tasks': { summary: 'Criar tarefa na coluna', body: createTaskSchema },
  'GET /tasks': { summary: 'Listar tarefas', description: 'Minhas tarefas, do departamento ou do escritório, conforme o papel e os filtros.', querystring: listTasksQuerySchema },
  'POST /tasks/assume-bulk': { summary: 'Assumir várias tarefas', body: assumeBulkSchema },
  'POST /tasks/:id/assume': { summary: 'Assumir tarefa', description: 'Falha com 409 se outra pessoa assumiu antes (`expectedAssigneeId`).', body: assumeTaskSchema },
  'PATCH /tasks/:id/move': { summary: 'Mover tarefa de coluna', description: 'Dispara a notificação de etapa para o cliente quando a tarefa é visível a ele.', body: moveTaskSchema },
  'PATCH /tasks/:id': { summary: 'Alterar tarefa', description: 'Título, prazo, prioridade, status, responsável (pode ser de outro departamento) e visibilidade para o cliente.', body: updateTaskSchema },
  'GET /tasks/:id/history': { summary: 'Histórico da tarefa' },
  'DELETE /tasks/:id': { summary: 'Excluir tarefa' },
  'POST /tasks/:id/regenerate': { summary: 'Gerar de novo tarefa de recorrência', description: 'Refaz a tarefa a partir do modelo recorrente atual.' },
  'POST /tasks/:id/release': { summary: 'Liberar OS antes da dependência', description: 'Com justificativa.', body: releaseEarlySchema, roles: ['Admin', 'Gerente'] },
  'PATCH /tasks/:id/delay-reason': { summary: 'Informar motivo de atraso da tarefa', body: setDelayReasonSchema },

  'GET /tasks/:taskId/comments': { summary: 'Comentários da tarefa', description: 'O cliente não recebe os comentários internos.' },
  'POST /tasks/:taskId/comments': { summary: 'Comentar na tarefa', description: '`isInternal: true` deixa o comentário só para a equipe (ignorado quando quem escreve é o cliente).', body: createCommentSchema },
  'DELETE /comments/:id': { summary: 'Apagar comentário' },

  'GET /tasks/:id/documents': { summary: 'Documentos pedidos e entregues da tarefa' },
  'POST /tasks/:id/documents/requests': { summary: 'Pedir documento ao cliente', body: addDocumentItemSchema },
  'POST /tasks/:id/documents/deliveries': { summary: 'Prever documento a entregar ao cliente', body: addDeliverableSchema },
  'PATCH /tasks/:id/documents/requests/:reqId': { summary: 'Aprovar ou recusar documento enviado pelo cliente', body: reviewDocumentRequirementSchema },
  'POST /tasks/:id/documents/deliveries/:reqId/upload': { summary: 'Enviar documento ao cliente', upload: {} },
  'POST /tasks/:id/documents/deliveries/:reqId/check': { summary: 'Conferir arquivo antes de entregar', description: 'Lê o arquivo e avisa se não parece ser o documento esperado; não salva nada.', upload: {} },
  'POST /tasks/:id/documents/requests/:reqId/upload': { summary: 'Anexar pelo escritório documento pedido ao cliente', upload: {} },

  'POST /tasks/:id/attachments': { summary: 'Anexar arquivo à tarefa', description: 'PDF, imagem e documentos de escritório; o conteúdo precisa bater com a extensão.', upload: {} },
  'GET /tasks/:id/attachments': { summary: 'Anexos da tarefa' },
  'DELETE /tasks/:id/attachments/:attachmentId': { summary: 'Apagar anexo', description: 'Recusado quando o arquivo está ligado a um documento ou protocolo.' },

  'GET /tasks/:id/approvals': { summary: 'Aprovações pedidas ao cliente nesta tarefa' },
  'POST /tasks/:id/approvals': { summary: 'Pedir aprovação ao cliente', description: 'O arquivo a aprovar vai depois dos campos.', upload: { fields: { title: 'O que o cliente deve aprovar (até 200 caracteres)', message: 'Mensagem ao cliente (opcional)' } } },
  'POST /approvals/:id/close': { summary: 'Encerrar aprovação sem resposta do cliente', description: 'JSON `{ reason, note }`, ou multipart com os mesmos campos antes de um print opcional como prova.', body: closeApprovalSchema },

  'GET /os': { summary: 'Lista de OS', querystring: listOSQuerySchema },
  'POST /os': { summary: 'Abrir OS avulsa para um cliente', body: openOSSchema },
  'GET /dashboard/os': { summary: 'Painel de OS: no prazo, atrasadas, aguardando cliente', querystring: osDashboardQuerySchema },

  'GET /os-models': { summary: 'Listar modelos de OS', querystring: listOSModelsQuerySchema },
  'GET /os-models/:id': { summary: 'Detalhe do modelo de OS' },
  'POST /os-models': { summary: 'Criar modelo de OS', description: 'Departamento, prazo interno em dias úteis, documentos pedidos e entregues.', body: createOSModelSchema },
  'PATCH /os-models/:id': { summary: 'Alterar modelo de OS', body: updateOSModelSchema },
  'DELETE /os-models/:id': { summary: 'Arquivar modelo de OS' },

  'GET /process-templates': { summary: 'Listar modelos de processo' },
  'GET /process-templates/:id': { summary: 'Detalhe do modelo de processo' },
  'POST /process-templates': { summary: 'Criar modelo de processo', description: 'Colunas e as OS de cada uma, com dependências.', body: createProcessTemplateSchema },
  'PATCH /process-templates/:id': { summary: 'Alterar modelo de processo', body: updateProcessTemplateSchema },
  'DELETE /process-templates/:id': { summary: 'Arquivar modelo de processo' },

  'GET /delay-reasons': { summary: 'Listar motivos de atraso' },
  'POST /delay-reasons': { summary: 'Criar motivo de atraso', body: createDelayReasonSchema },
  'PATCH /delay-reasons/:id': { summary: 'Alterar motivo de atraso', body: updateDelayReasonSchema },
  'DELETE /delay-reasons/:id': { summary: 'Remover motivo de atraso' },

  'GET /recurring-templates': { summary: 'Listar tarefas recorrentes' },
  'GET /recurring-templates/failed-generations': { summary: 'Gerações que falharam' },
  'GET /recurring-templates/:id': { summary: 'Detalhe da tarefa recorrente' },
  'GET /recurring-templates/:id/assignments': { summary: 'Clientes que recebem a recorrência' },
  'GET /recurring-templates/:id/generation-log': { summary: 'Registro das gerações' },
  'POST /recurring-templates': { summary: 'Criar tarefa recorrente', body: createTemplateSchema },
  'PATCH /recurring-templates/:id': { summary: 'Alterar tarefa recorrente', body: updateTemplateSchema },
  'DELETE /recurring-templates/:id': { summary: 'Remover tarefa recorrente' },
  'POST /recurring-templates/:id/assignments': { summary: 'Incluir cliente na recorrência', body: createAssignmentSchema },
  'PATCH /recurring-templates/:id/assignments/:assignmentId': { summary: 'Alterar cliente da recorrência', body: updateAssignmentSchema },
  'DELETE /recurring-templates/:id/assignments/:assignmentId': { summary: 'Tirar cliente da recorrência' },
  'POST /recurring-templates/:id/assignments/bulk-generate': { summary: 'Gerar a competência para todos os clientes da recorrência', body: bulkGenerateSchema },
  'POST /recurring-templates/:id/assignments/bulk-regenerate': { summary: 'Gerar de novo a competência para os clientes da recorrência', body: bulkRegenerateSchema },
  'POST /recurring-templates/bulk-generate': { summary: 'Gerar a competência de todas as recorrências', body: bulkGenerateAllSchema },

  'GET /holidays': { summary: 'Listar feriados', description: 'Os mesmos para todo o sistema; contam no prazo em dias úteis.', querystring: listHolidaysQuerySchema },
  'GET /holidays/days': { summary: 'Dias de feriado num intervalo', querystring: holidayDaysQuerySchema },
  'POST /holidays': { summary: 'Cadastrar feriado', body: createHolidaySchema },
  'DELETE /holidays/:id': { summary: 'Remover feriado' },

  'GET /departments': { summary: 'Listar departamentos', description: 'Com `withCounts=true` (só Admin), cada departamento traz `peopleCount` (pessoas ativas) e `clientsCount` (clientes ativos atendidos).', querystring: listDepartmentsQuerySchema },
  'POST /departments': { summary: 'Criar departamento', body: createDepartmentSchema },
  'PATCH /departments/:id': { summary: 'Alterar departamento', body: updateDepartmentSchema },
  'DELETE /departments/:id': { summary: 'Remover departamento' },
}
