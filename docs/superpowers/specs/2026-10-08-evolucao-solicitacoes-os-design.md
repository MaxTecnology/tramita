# Evolução de Solicitações → Ordem de Serviço — Design

> Item 5 do roadmap de sub-projetos ativos (`docs/TASKS.md`).

## Objetivo

Fechar 4 lacunas concretas achadas no mapeamento do fluxo atual de `Request` (hoje: cliente cria
→ fica `PENDING` → admin aprova/vira `Task` ou rejeita, binário, sem conversa):

1. Nenhum link do cliente nem do admin pro processo/tarefa resultante depois de uma solicitação
   aprovada.
2. Decisão binária sem meio-termo — admin não tem como pedir mais informação sem já aprovar ou
   rejeitar.
3. Solicitação é estática — sem troca de mensagem entre cliente e escritório no meio do caminho
   (diferente de `Task`, que já tem `Comment`).
4. Cancelamento não cobre o caso "já foi aprovada, virou trabalho de verdade, mas o cliente quer
   desistir" — hoje só existe cancelamento pré-aprovação, pelo próprio cliente.

Automação de bot de WhatsApp foi explicitamente deixada de fora desta rodada (tema separado, a
decidir depois).

## Decisões de escopo (fechadas em brainstorming)

| Decisão | Escolha |
|---|---|
| Estado de triagem | Novo status `NEEDS_INFO` — bloqueia a decisão final até o cliente responder |
| Exigência pra entrar em NEEDS_INFO | Comentário obrigatório na mesma chamada (reaproveita a thread, sem campo duplicado tipo `rejectionReason`) |
| Retorno automático | Comentário de **cliente** numa Request `NEEDS_INFO` volta o status pra `PENDING` sozinho |
| Modelo de comentário | Thread completa (não resposta única), espelhando `Comment`/Task: soft-delete, autor user ou client, notificação pra outra parte |
| Link pós-aprovação | Corrige os dois lados (portal do cliente e tela interna) |
| Cancelamento pelo cliente | Só enquanto `PENDING` ou `NEEDS_INFO` (ainda não aprovada) — depois de `APPROVED`, cliente não cancela mais sozinho |
| Cancelamento pós-aprovação | Só o escritório, com motivo obrigatório (histórico pra eventual disputa); a `Task` resultante vira `DISREGARDED` |
| Trava de atividade no cancelamento pós-aprovação | Mesma regra de `regenerateTask`: só permite se a `Task` nunca teve `TaskHistory` (além de `created`), `Comment` ou `Attachment` — recomendação minha, sem confirmação explícita; ver nota na seção 2 |
| Quem pode comentar | Mesmo conjunto de `Comment`/Task: `ORG_ADMIN`, `ORG_MANAGER`, `ORG_MEMBER`, `CLIENT` (assumido, não só admin/manager) |
| Badge de pendências do admin | `NEEDS_INFO` não conta em `countPendingRequests` — quem precisa agir é o cliente, não o admin (assumido) |
| Departamento nulo | Sem `Request.departmentId`, pula `ClientAssignment` e cai direto pra `ORG_ADMIN`/`MANAGER` (assumido) |
| Tempo real do comentário | Reaproveita o evento `request:changed` já existente, sem SSE novo (assumido) |

## Arquitetura

### 1. Schema

```prisma
enum RequestStatus {
  PENDING
  NEEDS_INFO
  APPROVED
  REJECTED
  CANCELLED
}
```

`CANCELLED` passa a ter dois caminhos possíveis (cliente pré-aprovação, já existente; staff
pós-aprovação, novo) — não precisa de um status novo pra isso, só de campos que registrem quem e
por quê:

```prisma
// em Request, campos novos:
cancelledByType CommentAuthorType? // USER = staff cancelou pós-aprovação; CLIENT = cliente cancelou antes
cancelledById    String?
cancellationReason String? // obrigatório no cancelamento pós-aprovação; null no cancelamento do cliente
```

```prisma
model RequestComment {
  id            String            @id @default(cuid())
  content       String
  requestId     String
  authorType    CommentAuthorType
  userId        String?
  clientId      String?
  deletedAt     DateTime?
  deletedBy     String?
  deletedByType DeletedByType?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)
  user    User?   @relation(fields: [userId], references: [id])
  client  Client? @relation(fields: [clientId], references: [id])

  @@map("request_comments")
}
```

`Request` ganha a relação reversa `comments RequestComment[]`. Reaproveita os enums
`CommentAuthorType`/`DeletedByType` já existentes (`USER`/`CLIENT`) — não precisa de enum novo.

### 2. Backend

**Novo módulo** `src/modules/request-comments/` (espelhando `src/modules/comments/` ponto a
ponto — schema, service, routes):

- `GET /requests/:requestId/comments` — mesmo gate de escopo de cliente que `listComments` já
  aplica pra `Task` (via `getClientAccessScope`), adaptado pra `Request.clientId` diretamente (sem
  o cruzamento adicional de departamento que `Task` tem, já que `Request.departmentId` é
  opcional).
- `POST /requests/:requestId/comments` — cria o comentário; se o autor é `CLIENT` **e** a
  request está em `NEEDS_INFO`, muda o status pra `PENDING` na mesma transação.
- `DELETE /request-comments/:id` — soft-delete, mesmo padrão de `deleteComment`.

**`requests.service.ts`** ganha:

```typescript
export async function markNeedsInfo(
  id: string,
  organizationId: string,
  reviewerId: string,
  comment: string,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') throw new AppError(422, 'Só solicitações pendentes podem entrar em triagem')

  const [, updated] = await prisma.$transaction([
    prisma.requestComment.create({
      data: { requestId: id, content: comment, authorType: 'USER', userId: reviewerId },
    }),
    prisma.request.update({ where: { id }, data: { status: 'NEEDS_INFO' } }),
  ])

  await enqueueNotification({
    event: 'REQUEST_NEEDS_INFO',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, commentText: comment },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}
```

**Rota** `POST /requests/:id/needs-info` (`ORG_ADMIN`/`ORG_MANAGER`), schema
`{ comment: z.string().min(1) }`.

**Cancelamento do cliente** (`cancelRequest`, já existe) — ajusta a checagem de
`request.status !== 'PENDING'` pra `!['PENDING', 'NEEDS_INFO'].includes(request.status)`, sem
mais nenhuma mudança.

**Cancelamento pós-aprovação (novo, só staff):**

```typescript
export async function cancelApprovedRequest(
  id: string,
  organizationId: string,
  staffId: string,
  reason: string,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'APPROVED') throw new AppError(422, 'Só solicitações aprovadas podem ser canceladas por este caminho')
  if (!request.taskId) throw new AppError(422, 'Solicitação aprovada sem tarefa associada — estado inconsistente')

  // Mesma trava de regenerateTask (recurring-templates.service.ts) — nunca desconsidera
  // silenciosamente um trabalho que já teve movimento real.
  const [historyCount, commentCount, attachmentCount] = await Promise.all([
    prisma.taskHistory.count({ where: { taskId: request.taskId, action: { not: 'created' } } }),
    prisma.comment.count({ where: { taskId: request.taskId } }),
    prisma.attachment.count({ where: { taskId: request.taskId } }),
  ])
  if (historyCount > 0 || commentCount > 0 || attachmentCount > 0) {
    throw new AppError(409, 'Essa tarefa já teve movimentação — não pode ser cancelada por este caminho')
  }

  const [, updated] = await prisma.$transaction([
    prisma.task.update({ where: { id: request.taskId }, data: { status: 'DISREGARDED' } }),
    prisma.request.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledByType: 'USER',
        cancelledById: staffId,
        cancellationReason: reason,
      },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_CANCELLED',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, rejectionReason: reason },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}
```

**Rota** `POST /requests/:id/cancel` (`ORG_ADMIN`/`ORG_MANAGER`), schema
`{ reason: z.string().min(1) }` — nome de rota diferente de `DELETE` porque é uma ação de negócio
com efeito colateral (desconsiderar a Task), não uma remoção simples.

**`listRequestsQuerySchema`** ganha `NEEDS_INFO` no enum de status filtrável.

**Link pós-aprovação** — `getRequestById`/`listRequestsForOrg` passam a incluir, quando
`taskId` existir:

```typescript
task: { select: { id: true, column: { select: { boardId: true } } } }
```

Resposta expõe `boardId` (achatado, não aninhado) pro frontend montar o link direto, nos dois
endpoints.

### 3. Notificações

Três eventos novos em `NotificationEvent`: `REQUEST_NEEDS_INFO` (staff→cliente),
`REQUEST_COMMENT_ADDED` (bidirecional, mesmo padrão de `TASK_COMMENT_ADDED` — resolve destinatário
via `ClientAssignment(clientId, departmentId)` com fallback pra `ORG_ADMIN`/`ORG_MANAGER` quando
`Request.departmentId` é nulo ou quando o comentário é do cliente; notifica o cliente diretamente
quando é da equipe), e `REQUEST_CANCELLED` (staff→cliente, só no cancelamento pós-aprovação — o
cancelamento do próprio cliente não precisa notificar ele mesmo). Entram em `NotificationConfig`
(toggle), `DEFAULT_TEMPLATES`, `Notifications.tsx` e `Templates.tsx` — mesmo nivelamento já
aplicado aos demais eventos nesta sessão.

### 4. Frontend

- **Portal do cliente** (`Requests.tsx`): badge de status ganha `NEEDS_INFO` (ex: "Precisa de
  informação", cor de atenção); card expande pra mostrar a thread de comentários (reaproveitando
  o componente `Comments` já usado em `TaskDrawer`, generalizado pra aceitar `entityType:
  'task'|'request'` em vez de só `taskId`); quando `status === 'APPROVED'` e existe `boardId`, o
  card ganha um link "Ver processo" pra `/portal/board/:boardId`.
- **Tela interna** (`Requests.tsx` em `app/`): mesmo componente de thread; botão novo "Pedir mais
  informação" (abre modal com campo de comentário obrigatório, chama `POST
  /requests/:id/needs-info`) ao lado de Aprovar/Rejeitar, visível só quando `status === 'PENDING'`;
  linha da lista ganha link "Abrir processo" quando aprovada com `boardId` presente; botão
  "Cancelar" novo, visível só quando `status === 'APPROVED'`, abre modal com motivo obrigatório →
  `POST /requests/:id/cancel` — se a API devolver 409 (tarefa já teve movimento), mostra a
  mensagem de erro em vez de deixar cancelar.
- **Portal do cliente**: card de solicitação `CANCELLED` mostra o motivo (`cancellationReason`)
  quando foi o staff que cancelou (`cancelledByType === 'USER'`), mesmo padrão visual já usado
  pra `rejectionReason` em `REJECTED`.
- **Componente `Comments`** generalizado: troca a prop `taskId` por `entityType` +
  `entityId`, e os dois endpoints (`/tasks/:id/comments` vs `/requests/:id/comments`) resolvidos
  por um switch simples dentro do componente — evita duplicar o componente inteiro pra uma
  segunda entidade.

## Fora do escopo (v1)

- Automação de bot de WhatsApp (conversa separada, ainda não escopada).
- Anexo de arquivo direto no comentário (hoje `RequestAttachment` só existe na criação da
  solicitação, não editável depois) — se precisar, é extensão futura do `RequestComment`.
- Múltiplos ciclos de `NEEDS_INFO` com histórico visual de "quantas vezes foi pra triagem" — o
  comportamento funciona pra repetir o ciclo quantas vezes for preciso, só não há um contador/
  indicador dedicado disso na UI.

## Revisão própria

- **Placeholders:** nenhum — todo trecho de código é completo ou referência explícita ao arquivo
  espelhado (`comments.service.ts`), que já existe e pode ser lido integralmente no plano.
- **Consistência:** `RequestComment` usa os mesmos enums (`CommentAuthorType`, `DeletedByType`)
  de `Comment`, evitando duplicar enum só por estar em tabela diferente.
- **Ambiguidade resolvida:** reversão automática pra `PENDING` só dispara em comentário de
  **cliente** — um comentário de equipe enquanto já está `NEEDS_INFO` (ex: um follow-up antes do
  cliente responder) não reabre a decisão sozinho.
- **Segurança:** `request-comments` reaproveita a mesma trava de escopo de cliente
  (`getClientAccessScope`) já testada em `comments.service.ts` — cliente nunca lista nem comenta
  solicitação de outro cliente, mesmo sabendo o id.
- **Decisão sem confirmação explícita:** a trava de atividade zero no cancelamento pós-aprovação
  (mesma regra de `regenerateTask`) foi minha recomendação, não uma escolha confirmada
  explicitamente pelo usuário — registrado como tal na tabela de decisões, pra ficar claro que é
  revisável se o escritório preferir cancelar mesmo com atividade na tarefa.
- **Rastreabilidade pra disputa:** `cancelledByType`/`cancelledById`/`cancellationReason` em
  `Request` dão o registro mínimo pra uma eventual reclamação de qualquer lado — quem cancelou,
  quando (via `updatedAt`) e por quê, sem precisar vasculhar `TaskHistory` ou logs.
