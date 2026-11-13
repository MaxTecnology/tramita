# Central de notificações, conversa e aprovação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sino de notificações (equipe e cliente) com histórico e lidas/não lidas; conversa das tarefas recorrentes no portal; aprovação do cliente com fechamento registrado pelo escritório.

**Architecture:** Um módulo `inbox` grava `InAppNotification` (uma linha por destinatário) a partir de um helper `notifyInApp` chamado pelos serviços que já emitem eventos; rotas `/notifications` servem equipe e cliente pelo papel do token. A conversa reaproveita os comentários de tarefa e a central para "não lida". `TaskApproval` é um objeto próprio da tarefa, com escrita protegida e bloqueio de conclusão.

**Tech Stack:** Fastify v5, Prisma 6, Zod, BullMQ, Vitest; React 19, TanStack Query, Tailwind v4 (tokens), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-conversa-e-aprovacao-recorrentes-design.md`

## Global Constraints

- Mensagens ao usuário em pt-BR; código em inglês. Sem `any`/`as unknown`. Zod em toda entrada. Prisma só em serviços.
- Notificação no sino é **sempre** gravada (independe dos toggles de WhatsApp/e-mail); quem causou o evento não recebe.
- Cliente: só usuários com acesso à empresa **e** ao departamento do item; nunca tarefa `visibleToClient=false`.
- Escopo: cada um só lê/marca as próprias notificações; de outro → 404.
- Aprovação: pendente bloqueia concluir a tarefa → 409 `Há aprovação do cliente pendente`. Fechar sem o portal: motivo `APPROVED_OUTSIDE` | `NO_RESPONSE`, observação obrigatória (`Informe a observação`), print opcional, grava `waitedDays`.
- Corrida de decisão × fechamento: `updateMany where status=PENDING`; perdedor → 409 `Esta aprovação já foi decidida`.
- Uploads pela política única (`readUpload`). Migrations à mão (`prisma migrate diff`), aplicadas em dev e teste.
- Commits Conventional com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Telas com tokens, QA claro/escuro.

## Review Focus

1. Cliente com acesso só à Folha não recebe notificação de comentário numa tarefa do Fiscal da mesma empresa → teste na Task 3.
2. Comentário em tarefa interna (`visibleToClient=false`) não gera notificação para o cliente, nem no sino → teste na Task 3.
3. Abrir a conversa marca como lidas só as notificações daquela tarefa e daquele usuário (não as do colega do cliente) → teste na Task 5.
4. Concluir tarefa pelo Kanban (mover para coluna DONE) com aprovação pendente também é bloqueado, não só o PATCH de status → teste na Task 6.
5. Fechar sem o portal numa aprovação que o cliente acabou de aprovar → 409, sem sobrescrever a decisão do cliente → teste na Task 6.

---

### Task 1: Modelos — `InAppNotification`, `TaskApproval`, eventos

**Files:** `apps/api/prisma/schema.prisma`, migration `20261113200000_inbox_and_approvals`, `apps/api/src/lib/default-templates.ts`, `notifications.schema/service`, `notification.worker.ts` (map), test `src/modules/inbox/inbox.model.test.ts`

**Produces:**
- `InAppNotification { id, organizationId, recipientUserId?, recipientClientUserId?, type InAppType, title, body, link, taskId?, boardId?, requestId?, approvalId?, protocolId?, clientId?, actorName?, readAt?, createdAt }`, índices `(recipientUserId, readAt, createdAt)` e `(recipientClientUserId, readAt, createdAt)`; FKs com `onDelete: Cascade` para destinatários; check: exatamente um destinatário.
- `enum InAppType { TASK_COMMENT, REQUEST_CREATED, REQUEST_COMMENT, DOCUMENT_UPLOADED, APPROVAL_REQUESTED, APPROVAL_DECIDED, TASK_ASSUMED, TASK_ASSIGNED, BOARD_ASSIGNED, DOCUMENT_RECEIVED, DOCUMENT_REJECTED, REQUEST_STATUS }`
- `TaskApproval { id, taskId, organizationId, title, message?, attachmentId (unique), status ApprovalStatus @default(PENDING), requestedById, requestedAt, decidedAt?, decidedByClientUserId?, decidedByUserId?, decisionNote?, closeReason ApprovalCloseReason?, proofAttachmentId? (unique), waitedDays Int?, createdAt, updatedAt }`, índice `(taskId, status)`.
- `enum ApprovalStatus { PENDING, APPROVED, CHANGES_REQUESTED, CLOSED_BY_OFFICE }`, `enum ApprovalCloseReason { APPROVED_OUTSIDE, NO_RESPONSE }`.
- `NotificationEvent += APPROVAL_REQUESTED, APPROVAL_CHANGES_REQUESTED`; `NotificationConfig += approvalRequested Boolean @default(true), approvalChangesRequested Boolean @default(true)`; templates padrão para os dois; `EVENT_FLAG_MAP`.

- [ ] Teste: criar notificação sem destinatário viola o check; com os dois também; com um só ok. Aprovação: `attachmentId` único.
- [ ] Run → FAIL. Schema + migration (`ALTER TABLE ... ADD CONSTRAINT in_app_one_recipient CHECK (num_nonnulls("recipientUserId","recipientClientUserId") = 1)`), aplicar dev/teste, generate.
- [ ] Run → PASS; suíte API verde. Commit `feat(inbox): modelos de notificação no sistema e aprovação do cliente`.

### Task 2: API da central (`/notifications`)

**Files:** create `src/modules/inbox/inbox.service.ts|routes.ts|schema.ts`, register in `server.ts`; test `inbox.routes.test.ts`

**Produces:**
```ts
notifyInApp(input: {
  organizationId: string; type: InAppType; title: string; body: string; link: string;
  refs?: { taskId?; boardId?; requestId?; approvalId?; protocolId?; clientId? };
  actorName?: string;
  to: { userIds?: string[]; clientUserIds?: string[] };
  exclude?: { userId?: string; clientUserId?: string }   // who caused it
}): Promise<number>
clientUsersFor(clientId: string, departmentId: string | null): Promise<string[]>   // access to company AND department
```
Rotas (verifyJWT; destinatário pelo papel: `CLIENT` → `recipientClientUserId = sub`, staff → `recipientUserId = sub`):
`GET /notifications?status=all|read|unread&type=&clientId=&from=&to=&q=&cursor=&limit=` → `{ items, nextCursor }` (mais recentes primeiro; `limit` ≤ 50);
`GET /notifications/unread-count` → `{ count }`; `POST /notifications/:id/read`; `POST /notifications/:id/unread`; `POST /notifications/read-all`; `POST /notifications/read-by-task` `{ taskId }` (marca as do usuário daquela tarefa).

- [ ] Testes: lista/contador só do próprio destinatário (equipe e cliente); filtros status/tipo/cliente/busca; marcar lida/não lida; read-all; notificação de outro → 404; `notifyInApp` exclui quem causou e deduplica; `clientUsersFor` respeita empresa+departamento e ignora inativos.
- [ ] FAIL → implementar → PASS. Commit `feat(inbox): central de notificações (API)`.

### Task 3: Emissores — eventos da equipe e do cliente

**Files:** comments, request-comments, requests, task-documents, protocols (from-deliverable/service), tasks (create/update/transfer via responsibility-transfer), task-assume, boards (create); test `src/modules/inbox/inbox-events.test.ts`

Cada ponto chama `notifyInApp` (sem bloquear a resposta em caso de erro: logar `logger.warn`). Links: equipe tarefa `/app/tasks?task=<id>` (recorrente) ou `/app/board/<boardId>?task=<id>` (OS); solicitação `/app/requests?request=<id>`; cliente tarefa recorrente `/portal/send?competence=AAAA-MM&task=<id>`, OS `/portal/board/<boardId>?task=<id>`, documento `/portal/documents/<protocolId>`, solicitação `/portal/requests?request=<id>`.

- [ ] Testes (Review Focus 1 e 2 aqui): comentário do cliente → responsável da tarefa; comentário de colega → responsável (não o autor); comentário do escritório → usuários do cliente com acesso ao departamento (Folha-only não recebe; tarefa interna não gera); solicitação criada → responsável do (cliente, departamento); comentário em solicitação (cliente → responsável; escritório → cliente); upload do cliente num pedido → responsável; documento recusado → cliente; protocolo novo → cliente; aprovado/recusado/info/cancelado → cliente; assumir → anterior; tarefa atribuída a outro (criar/editar responsável/transferir) → novo responsável; processo criado com responsável → responsável.
- [ ] FAIL → implementar → PASS. Commit `feat(inbox): notificações dos eventos para equipe e cliente`.

### Task 4: Web — sino e página de notificações (equipe e portal)

**Files:** create `apps/web/src/components/shared/NotificationBell.tsx`, `NotificationList.tsx`, `pages/app/Notifications.tsx`, `pages/portal/Notifications.tsx`; modify `AppLayout.tsx`, `pages/portal/Layout.tsx`, `router.tsx`; test `NotificationBell.test.tsx`

- [ ] Teste: sino mostra o número de não lidas; clicar num item chama `POST /notifications/:id/read` e navega para o `link`; "Marcar todas como lidas".
- [ ] FAIL → implementar (refetch on window focus + `refetchInterval: 60_000`; dropdown com 10 últimas; página com Todas/Lidas/Não lidas, tipo, cliente (equipe), período, busca, carregar mais) → PASS. `/app/notifications` e `/portal/notifications`. Telas que recebem `?task=`/`?request=` abrem o item: `Tasks.tsx`, `Board.tsx`, `Requests.tsx` (equipe), `SendDocuments.tsx`, `portal/Board.tsx`, `portal/Requests.tsx`.
- [ ] Commit `feat(web): sino de notificações para equipe e cliente`.

### Task 5: Conversa da recorrente no portal

**Files:** `portal-overview.service.ts` (`listDocumentRequestsByMonth` → agrupado por tarefa), `portal.routes.ts`, `pages/portal/SendDocuments.tsx`, `pages/portal/Home.tsx`, `notification.worker.ts` (link do comentário); tests `portal-conversation.test.ts`

**Produces:** `GET /portal/document-requests?clientId&competence` → `{ competence, tasks: [{ taskId, title, departmentName, requests[], approvals[], unreadMessages }] }` incluindo tarefa recorrente visível sem pedido quando tem comentário ou aprovação; `GET /portal/home` += `unreadMessages`, `pendingApprovals`.

- [ ] Testes: agrupamento; tarefa sem pedido com comentário aparece; sem nada não aparece; `unreadMessages` por usuário; `read-by-task` marca só daquele usuário e tarefa (Review Focus 3); link do e-mail de comentário aponta para `/portal/send?competence=…&task=…`.
- [ ] FAIL → implementar; web: grupos por tarefa, botão **Conversa (N)** abre `Comments` (entityType task) e chama `read-by-task`; `?task=` abre direto; Início com "Mensagens do escritório" → PASS. Commit `feat(portal): conversa das tarefas recorrentes`.

### Task 6: Aprovação — API

**Files:** create `src/modules/approvals/approvals.service.ts|routes.ts|schema.ts`; modify `tasks.service.ts` (gate em `updateTask` e `moveTask` para DONE), `task-history` labels; test `approvals.test.ts`

**Produces:** equipe `POST /tasks/:id/approvals` (multipart: `title`, `message?`, file; staffScope write; tarefa visível ao cliente senão 422 `Só tarefas visíveis ao cliente podem pedir aprovação`), `GET /tasks/:id/approvals`, `POST /approvals/:id/close` (multipart: `reason`, `note`, file opcional); cliente `GET /portal/tasks/:taskId/approvals`, `POST /portal/approvals/:id/approve`, `POST /portal/approvals/:id/request-changes` `{ note }` (obrigatório). Histórico `approval_requested|approval_approved|approval_changes_requested|approval_closed_by_office`. Avisos: `APPROVAL_REQUESTED` (cliente, WhatsApp/e-mail + sino), `APPROVAL_CHANGES_REQUESTED` (equipe) e sino `APPROVAL_DECIDED` ao responsável.

- [ ] Testes: pedir (arquivo, aviso, histórico); aprovar e pedir ajuste (quem/quando, nota obrigatória); escopo do cliente (404 fora); fechar sem o portal (motivos, nota obrigatória, `waitedDays`, print); concluir com pendente → 409 por PATCH **e** por mover para coluna DONE (Review Focus 4); corrida decisão × fechamento → 409 sem sobrescrever (Review Focus 5); pedido em tarefa interna → 422.
- [ ] FAIL → implementar → PASS. Commit `feat(approvals): aprovação do cliente com fechamento registrado`.

### Task 7: Aprovação — web (equipe e portal) e configurações

**Files:** `components/shared/task-documents/ApprovalsSection.tsx` (no TaskDrawer, aba Documentos), `pages/portal/SendDocuments.tsx` (bloco de aprovação no grupo), `pages/portal/Home.tsx` (cartão "Aguardando sua aprovação"), `settings/Notifications.tsx`, `settings/Templates.tsx`; test `ApprovalsSection.test.tsx`, `PortalApproval.test.tsx`

- [ ] Testes: drawer pede aprovação (form + arquivo), mostra pendente com "Fechar sem o portal" (motivo, observação obrigatória, print); portal aprova e pede ajuste (nota obrigatória), mostra decidido.
- [ ] FAIL → implementar → PASS. Selo "Aguardando aprovação do cliente" no drawer e na lista de tarefas. Commit `feat(web): aprovação do cliente no painel da tarefa e no portal`.

### Task 8: E2E, docs e QA

- [ ] Seed E2E: tarefa recorrente visível com comentário do escritório; specs: cliente vê sino → abre conversa → responde; escritório pede aprovação → cliente aprova → escritório conclui; caminho "fechar sem o portal". Suíte E2E 2×.
- [ ] SPEC.md (rotas novas), TASKS.md, tech-debt. QA claro/escuro: sino e página (equipe e portal), Enviar documentos agrupado com conversa, aprovação no drawer e no portal.
- [ ] Commit `test(e2e): notificações, conversa e aprovação; docs`.
