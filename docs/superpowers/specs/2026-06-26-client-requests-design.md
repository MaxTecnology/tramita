# Design — Solicitações do Cliente Final (Request)

## Objetivo

Permitir que o Cliente Final abra uma solicitação ("Request") no portal, que o
escritório triagem (aprova ou rejeita) antes de virar um processo real
(`Task`). Hoje o cliente só pode comentar em tarefas já existentes — não há
nenhum jeito dele iniciar uma demanda nova.

Fora do escopo desta entrega (fica para uma fase futura): cadastro de "tipos
de pedido" pelo escritório e seleção de tipo pelo cliente ao abrir a
solicitação.

## Fluxo

1. Cliente final abre uma `Request` no portal (`título` + `descrição` +
   anexos opcionais).
2. Escritório (`ORG_ADMIN`/`ORG_MANAGER`) é notificado por email.
3. Escritório revisa a fila de solicitações pendentes e decide:
   - **Aprovar** → escolhe anexar a um `Board` existente do cliente (Task
     entra na coluna escolhida) OU criar um novo `Board` (reusa a criação com
     3 colunas padrão já existente). `Request` muda para `APPROVED`, grava
     `taskId`, `reviewedById`, `reviewedAt`. A `Task` criada grava
     `sourceRequestId` apontando de volta para a `Request`.
   - **Rejeitar** → `Request` muda para `REJECTED`, com motivo opcional.
4. Cliente é notificado (WhatsApp/Email, conforme `NotificationConfig` da
   org) do resultado.
5. Enquanto `PENDING`, o cliente pode cancelar a própria solicitação
   (`CANCELLED`). Não há edição de conteúdo após o envio — para mudar, o
   cliente cancela e abre uma nova.

## Schema (Prisma)

```prisma
model Request {
  id              String        @id @default(cuid())
  organizationId  String
  clientId        String
  title           String
  description     String?
  status          RequestStatus @default(PENDING)
  taskId          String?       @unique
  rejectionReason String?
  reviewedById    String?
  reviewedAt      DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id])
  client       Client              @relation(fields: [clientId], references: [id])
  task         Task?               @relation(fields: [taskId], references: [id])
  reviewedBy   User?               @relation(fields: [reviewedById], references: [id])
  attachments  RequestAttachment[]

  @@index([organizationId, status])
  @@map("requests")
}

enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

model RequestAttachment {
  id         String   @id @default(cuid())
  requestId  String
  filename   String
  mimeType   String
  size       Int
  storageKey String
  uploadedBy String   // clientId
  createdAt  DateTime @default(now())

  request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@map("request_attachments")
}
```

Mudanças em modelos existentes:

- `Task.sourceRequestId String? @unique` (+ relation) — rastreabilidade
  reversa, usada para badge "originado de solicitação" no card.
- `NotificationConfig`: `requestCreated`, `requestApproved`,
  `requestRejected` (Boolean, default `true`).
- `NotificationLog` e `MessageTemplate`: `requestId String?` opcional,
  espelhando `taskId?`.
- `NotificationEvent`: + `REQUEST_CREATED`, `REQUEST_APPROVED`,
  `REQUEST_REJECTED`.

`RequestAttachment` é um modelo próprio, não reaproveita `Attachment`
(que tem FK obrigatória em `taskId`) — mantém o módulo de requests isolado
sem tocar numa feature já em produção.

## Notificações

`NotificationJob` (`apps/api/src/lib/queue.ts`) hoje assume destinatário
`Client`. Estender para suportar `User`:

```typescript
export interface NotificationJob {
  event: NotificationEvent
  organizationId: string
  recipientType: 'CLIENT' | 'USER'
  clientId?: string        // recipientType === 'CLIENT'
  userId?: string          // recipientType === 'USER' — um job por destinatário
  taskId?: string
  requestId?: string
  metadata: Record<string, string | undefined>
}
```

- `REQUEST_CREATED`: ao criar a `Request`, busca todos `User` da org com
  role `ORG_ADMIN` ou `ORG_MANAGER` e enfileira um job por usuário
  (`recipientType: 'USER'`). Canal: **só email** (sem WhatsApp para esse
  evento). Worker resolve `User.email`, grava `NotificationLog` por
  destinatário (sem `clientId`, com `requestId`).
- `REQUEST_APPROVED` / `REQUEST_REJECTED`: reusa o caminho `CLIENT` já
  existente (mesmo padrão de `TASK_MOVED`), respeitando canais habilitados em
  `NotificationConfig`.

Vars de template novas: `requestTitle`. As demais (`clientName`, `orgName`,
`portalUrl`) já existem em `TemplateVars`.

## Endpoints

### Portal (Client)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/portal/requests` | `{ title, description? }` → cria PENDING, enfileira `REQUEST_CREATED` |
| GET | `/portal/requests` | lista as próprias requests |
| GET | `/portal/requests/:id` | detalhe + anexos |
| POST | `/portal/requests/:id/attachments` | upload multipart (≤20MB), só enquanto `PENDING` |
| PATCH | `/portal/requests/:id/cancel` | só enquanto `PENDING` → `CANCELLED` |

### Escritório

| Método | Rota | Role mínimo | Descrição |
|---|---|---|---|
| GET | `/requests` | qualquer autenticado da org | lista com filtros `status`/`clientId` |
| GET | `/requests/:id` | qualquer autenticado da org | detalhe + anexos |
| POST | `/requests/:id/approve` | `ORG_ADMIN`/`ORG_MANAGER` | ver corpo abaixo |
| POST | `/requests/:id/reject` | `ORG_ADMIN`/`ORG_MANAGER` | `{ reason? }` |

Corpo de `approve`:

```typescript
{ mode: 'EXISTING_BOARD', boardId: string, columnId: string }
| { mode: 'NEW_BOARD' }
```

- `NEW_BOARD` → reusa a função de criação de board com 3 colunas padrão já
  existente em `boards.service.ts`; Task cai na primeira coluna.
- `EXISTING_BOARD` → cria a `Task` direto na `columnId` informada (valida
  que o board pertence ao mesmo `clientId` da request).

`checkSubscription` aplicado em todos os endpoints de mutação (create,
approve, reject, cancel), igual ao padrão atual de Task/Board.

## Frontend

- **Portal** (`/portal/requests`): lista com badge de status, botão "Nova
  solicitação" (form título + descrição + dropzone de anexos), tela de
  detalhe com botão "Cancelar" quando `PENDING`.
- **Escritório** (`/app/requests`): lista com filtro de status e contador de
  pendentes (badge no menu, mesmo padrão de outros contadores existentes).
  Modal de aprovação com alternância "Anexar a processo existente" (select
  de board + coluna do cliente) vs "Criar novo processo". Botão de
  rejeição com campo de motivo opcional.
- Card de `Task` no board ganha um ícone/badge quando `sourceRequestId`
  não é nulo.

## Testes (obrigatórios, lógica crítica)

- `requests.service.test.ts`: transições de status válidas/inválidas
  (cancelar após aprovado deve falhar, aprovar duas vezes deve falhar),
  criação de Task em `EXISTING_BOARD` vs `NEW_BOARD`, validação de que o
  board pertence ao mesmo cliente da request.
- `requests.routes.test.ts`: `ORG_MEMBER` não pode aprovar/rejeitar (403),
  cliente não acessa/cancela request de outro cliente (tenant isolation).
- `notification-worker.test.ts` (extensão): `REQUEST_CREATED` envia para
  todos `ORG_ADMIN`/`ORG_MANAGER` da org, não envia para `ORG_MEMBER`.

## Fora do escopo

- Cadastro de "tipos de pedido" pelo escritório (`RequestType`) e campo de
  tipo na `Request` — fase futura, entra com `requestTypeId` FK opcional
  quando o catálogo existir.
- Edição de conteúdo da `Request` pelo cliente após o envio.
