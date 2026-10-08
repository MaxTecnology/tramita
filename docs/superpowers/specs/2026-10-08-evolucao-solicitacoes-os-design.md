# Evolução de Solicitações → Ordem de Serviço — Design

> Item 5 do roadmap de sub-projetos ativos (`docs/TASKS.md`).

## Objetivo

Fechar 3 lacunas concretas achadas no mapeamento do fluxo atual de `Request` (hoje: cliente cria
→ fica `PENDING` → admin aprova/vira `Task` ou rejeita, binário, sem conversa):

1. Nenhum link do cliente nem do admin pro processo/tarefa resultante depois de uma solicitação
   aprovada.
2. Decisão binária sem meio-termo — admin não tem como pedir mais informação sem já aprovar ou
   rejeitar.
3. Solicitação é estática — sem troca de mensagem entre cliente e escritório no meio do caminho
   (diferente de `Task`, que já tem `Comment`).

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

**`listRequestsQuerySchema`** ganha `NEEDS_INFO` no enum de status filtrável.

**Link pós-aprovação** — `getRequestById`/`listRequestsForOrg` passam a incluir, quando
`taskId` existir:

```typescript
task: { select: { id: true, column: { select: { boardId: true } } } }
```

Resposta expõe `boardId` (achatado, não aninhado) pro frontend montar o link direto, nos dois
endpoints.

### 3. Notificações

Dois eventos novos em `NotificationEvent`: `REQUEST_NEEDS_INFO` (staff→cliente) e
`REQUEST_COMMENT_ADDED` (bidirecional, mesmo padrão de `TASK_COMMENT_ADDED` — resolve destinatário
via `ClientAssignment(clientId, departmentId)` com fallback pra `ORG_ADMIN`/`ORG_MANAGER` quando
comentário é do cliente; notifica o cliente diretamente quando é da equipe). Entram em
`NotificationConfig` (toggle), `DEFAULT_TEMPLATES`, `Notifications.tsx` e `Templates.tsx` — mesmo
nivelamento já aplicado aos demais eventos nesta sessão.

### 4. Frontend

- **Portal do cliente** (`Requests.tsx`): badge de status ganha `NEEDS_INFO` (ex: "Precisa de
  informação", cor de atenção); card expande pra mostrar a thread de comentários (reaproveitando
  o componente `Comments` já usado em `TaskDrawer`, generalizado pra aceitar `entityType:
  'task'|'request'` em vez de só `taskId`); quando `status === 'APPROVED'` e existe `boardId`, o
  card ganha um link "Ver processo" pra `/portal/board/:boardId`.
- **Tela interna** (`Requests.tsx` em `app/`): mesmo componente de thread; botão novo "Pedir mais
  informação" (abre modal com campo de comentário obrigatório, chama `POST
  /requests/:id/needs-info`) ao lado de Aprovar/Rejeitar, visível só quando `status === 'PENDING'`;
  linha da lista ganha link "Abrir processo" quando aprovada com `boardId` presente.
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
