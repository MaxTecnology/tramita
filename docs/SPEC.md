# API Spec — Tramita

## Base URL: `/api/v1`

---

## Autenticação

### POST `/auth/login`
Login unificado — role no JWT discrimina acesso (`MASTER`, `ORG_ADMIN`, `ORG_MANAGER`, `ORG_MEMBER`, `CLIENT`).

**Body:** `{ "email": "string", "password": "string" }`

**Response:**
```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "user": {
    "id": "string",
    "name": "string",
    "role": "string",
    "organizationId": "string | null"
  }
}
```

### POST `/auth/refresh` — `{ "refreshToken": "string" }`
### POST `/auth/logout` — invalida refresh token no Redis

---

## Master — Painel AutoHubs

> Todas as rotas `/master/*` exigem `role: MASTER`

### Planos

#### GET `/master/plans` — lista todos os planos
#### POST `/master/plans`
```json
{
  "name": "Starter",
  "maxClients": 30,
  "priceMonthly": 197.00,
  "features": { "pdf": true, "sse": true, "attachments": true }
}
```
#### PATCH `/master/plans/:id`
#### DELETE `/master/plans/:id` — soft delete (isActive: false)

### Escritórios

#### GET `/master/organizations` — lista com status da assinatura e uso
#### GET `/master/organizations/:id` — detalhes + histórico de pagamentos + lista de usuários
#### PATCH `/master/organizations/:id` — alterar plano, suspender, reativar
#### POST `/master/organizations` — cadastro manual pelo Master (sem passar pelo `/organizations/register` público)
```json
{
  "name": "string",
  "email": "string",
  "phone": "string?",
  "cnpj": "string?",
  "planId": "string",
  "adminName": "string",
  "createAsaasSubscription": false
}
```
→ Cria Organization (`subscriptionStatus: ACTIVE` direto, sem trial) + User (ORG_ADMIN)
→ Senha do ORG_ADMIN é **gerada pelo servidor**, nunca definida no formulário — retorna `temporaryPassword` em texto puro só nesta resposta (não fica persistida em lugar nenhum)
→ `cnpj` só é obrigatório quando `createAsaasSubscription: true`; nesse caso cria Customer + Subscription no Asaas igual ao `/organizations/register` (com o mesmo rollback se a Asaas falhar)

#### POST `/master/organizations/:orgId/users/:userId/reset-password` — redefine a senha de qualquer usuário da organização
→ Mesmo mecanismo de senha gerada do endpoint acima; retorna `{ id, name, email, temporaryPassword }`

#### GET `/master/revenue` — receita total, MRR, churn (agregados do Asaas)

---

## Escritórios — Cadastro Público

### POST `/organizations/register`
Cadastro de novo escritório (público — sem autenticação).
```json
{
  "name": "string",
  "cnpj": "string?",
  "email": "string",
  "phone": "string?",
  "adminName": "string",
  "adminPassword": "string",
  "planId": "string"
}
```
→ Cria Organization + User (ORG_ADMIN) + Customer no Asaas + Subscription no Asaas
→ Inicia trial de 14 dias se planId = "trial"

### GET `/organizations/plans` — lista planos disponíveis (público)

---

## Organização — Configurações

> Rotas `/org/*` exigem `role: ORG_ADMIN`

### GET `/org/settings` — dados da organização + plano atual + uso
### PATCH `/org/settings` — atualizar nome, email, telefone
### GET `/org/subscription` — status Asaas, próxima cobrança, histórico
### POST `/org/subscription/change-plan` — `{ "planId": "string" }`

---

## Usuários Internos

### GET `/users` _(ORG_ADMIN)_ — lista usuários da org
### POST `/users` _(ORG_ADMIN)_
```json
{ "name": "string", "email": "string", "password": "string", "role": "ORG_MANAGER|ORG_MEMBER", "phone": "string?" }
```
### PATCH `/users/:id` _(ORG_ADMIN)_
### DELETE `/users/:id` _(ORG_ADMIN)_ — soft delete
### POST `/users/:id/reset-password` _(ORG_ADMIN)_ — redefine a senha de `ORG_MANAGER`/`ORG_MEMBER` da própria org
→ Senha gerada pelo servidor, retorna `{ id, name, email, temporaryPassword }` em texto puro só nesta resposta
→ Não permite redefinir senha de outro `ORG_ADMIN` (escopado por `role` no backend, não só escondido na UI)

---

## Clientes Finais

### GET `/clients` _(ORG_ADMIN | ORG_MANAGER)_
### POST `/clients` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "name": "string", "cnpj": "string?", "email": "string", "password": "string", "whatsapp": "string?" }
```
→ Middleware `checkPlanLimit` valida `clientsCount < plan.maxClients` antes de criar

### PATCH `/clients/:id`
### DELETE `/clients/:id` — soft delete (não conta no limite ao desativar)

---

## Boards

### GET `/boards` — ORG_ADMIN/MANAGER: todos | CLIENT: próprio
### GET `/boards/:id` — board com colunas e tarefas ordenadas por position
### POST `/boards` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "title": "string", "description": "string?", "clientId": "string" }
```
### PATCH `/boards/:id`

---

## Colunas

### POST `/boards/:boardId/columns` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "title": "string", "color": "#hex?", "position": 0, "isFinal": false }
```
### PATCH `/columns/:id`
### PATCH `/columns/reorder` — `[{ "id": "string", "position": 0 }]`
### DELETE `/columns/:id` _(ORG_ADMIN)_

---

## Tarefas

### POST `/columns/:columnId/tasks` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
```json
{
  "title": "string",
  "description": "string?",
  "priority": "LOW|MEDIUM|HIGH|URGENT",
  "assigneeId": "string?",
  "dueDate": "ISO8601?",
  "tags": ["string"]
}
```
→ Dispara `TASK_CREATED` → notification queue

### PATCH `/tasks/:id`
### PATCH `/tasks/:id/move`
```json
{ "columnId": "string", "position": 0 }
```
→ Dispara `TASK_MOVED`. Se coluna `isFinal: true` → dispara também `TASK_COMPLETED`

### PATCH `/tasks/reorder` — `[{ "id": "string", "position": 0, "columnId": "string" }]`
### DELETE `/tasks/:id` _(ORG_ADMIN | ORG_MANAGER)_
### GET `/boards/:id/tasks/search?q=&priority=&assigneeId=&status=&dueBefore=&dueAfter=`

---

## Comentários

### GET `/tasks/:taskId/comments`
### POST `/tasks/:taskId/comments`
```json
{ "content": "string" }
```
→ Autor detectado pelo JWT (`userId` ou `clientId` + `organizationId`)
→ Dispara `TASK_COMMENT_ADDED`

### DELETE `/comments/:id` _(autor ou ORG_ADMIN)_

---

## Anexos

### POST `/tasks/:id/attachments` — multipart, max 20MB
### GET `/tasks/:id/attachments` — lista com `signedUrl` TTL 1h
### DELETE `/tasks/:id/attachments/:attachmentId`

---

## Templates de Mensagem

### GET `/notifications/templates` _(ORG_ADMIN)_
Lista todos os templates da org (WhatsApp + Email por evento).

### GET `/notifications/templates/:event/:channel` _(ORG_ADMIN)_
Retorna template atual ou o template padrão do sistema se não configurado.

### PUT `/notifications/templates/:event/:channel` _(ORG_ADMIN)_
Cria ou atualiza template para o evento + canal.
```json
{
  "subject": "string?",
  "body": "Olá, {{clientName}}! Seu processo *{{taskTitle}}* avançou para *{{toColumn}}*.\n\nAcompanhe: {{portalUrl}}"
}
```

### DELETE `/notifications/templates/:event/:channel` _(ORG_ADMIN)_
Remove template customizado (volta a usar o padrão do sistema).

### POST `/notifications/templates/preview` _(ORG_ADMIN)_
Renderiza prévia do template com dados fictícios.
```json
{
  "event": "TASK_MOVED",
  "channel": "WHATSAPP",
  "body": "Olá, {{clientName}}! ..."
}
```
**Response:**
```json
{
  "rendered": "Olá, João Silva! Seu processo *Abertura de LTDA* avançou para *Aguardando Assinatura*.\n\nAcompanhe: https://tramita.autohubs.com.br/portal"
}
```

---

## Configuração de Notificações

### GET `/notifications/config` _(ORG_ADMIN)_
### PATCH `/notifications/config` _(ORG_ADMIN)_
```json
{
  "whatsappEnabled": true,
  "emailEnabled": false,
  "taskMoved": true,
  "taskCompleted": true,
  "commentAdded": true,
  "dueDateAlert": true,
  "maximizebotToken": "Bearer <token>",
  "saveOnTicket": true,
  "startChatbot": false,
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "smtpUser": "noreply@escritorio.com.br",
  "smtpPass": "senha_smtp",
  "emailFrom": "Escritório <noreply@escritorio.com.br>"
}
```

### POST `/notifications/config/test-whatsapp` _(ORG_ADMIN)_
Envia mensagem de teste para validar configuração MaximizeBot.
```json
{ "number": "5582999999999" }
```

### POST `/notifications/config/test-email` _(ORG_ADMIN)_
Envia email de teste para validar configuração SMTP.
```json
{ "to": "email@teste.com" }
```

### GET `/notifications/logs` _(ORG_ADMIN)_
**Query:** `?page=1&limit=50&status=SENT|FAILED|PENDING&channel=WHATSAPP|EMAIL`

---

## Worker de Notificações (BullMQ)

### Queue: `notification-queue`

**Job payload:**
```typescript
interface NotificationJob {
  event: NotificationEvent
  taskId: string
  organizationId: string
  clientId: string
  metadata: {
    taskTitle: string
    fromColumn?: string
    toColumn?: string
    dueDate?: string
    commentAuthorName?: string
    commentText?: string
  }
}
```

**Lógica do Worker:**
1. Busca `NotificationConfig` da org — evento habilitado?
2. Busca client (nome + whatsapp + email)
3. Para cada canal habilitado (WHATSAPP, EMAIL):
   a. Busca `MessageTemplate` customizado ou usa padrão do sistema
   b. Interpola variáveis: `{{clientName}}` → `"João Silva"`, etc.
   c. Envia via MaximizeBot ou Nodemailer
   d. Salva log em `NotificationLog`
4. Retry: 3x com backoff exponencial (1s → 5s → 30s)
5. Falha definitiva → `NotificationLog.status = FAILED`

**Envio MaximizeBot:**
```typescript
await axios.post(
  'https://app.maximizebot.com.br/backend/api/messages/send',
  {
    number: client.whatsapp,
    body: renderedTemplate,
    saveOnTicket: config.saveOnTicket,
    startChatbot: config.startChatbot,
    linkPreview: true
  },
  { headers: { Authorization: config.maximizebotToken } }
)
```

---

## Webhook Asaas

### POST `/webhooks/asaas`
Recebe eventos de pagamento do Asaas.

| Evento Asaas            | Ação no Tramita                                 |
|-------------------------|--------------------------------------------------|
| `PAYMENT_CONFIRMED`     | `subscriptionStatus = ACTIVE`, renova período   |
| `PAYMENT_OVERDUE`       | `subscriptionStatus = GRACE_PERIOD` (7 dias)    |
| `PAYMENT_DELETED`       | `subscriptionStatus = SUSPENDED`                |
| `SUBSCRIPTION_DELETED`  | `subscriptionStatus = CANCELLED`                |

---

## SSE — Tempo Real

### GET `/boards/:id/stream?token=<accessToken>`

**Eventos emitidos:**
```
event: task:moved
data: {"taskId":"...","fromColumn":"...","toColumn":"...","position":2}

event: task:created
data: { ...taskPayload }

event: task:updated
data: {"taskId":"...","changes":{...}}

event: comment:added
data: {"taskId":"...","comment":{...}}

event: heartbeat
data: {"ts":1717200000}
```

---

## Relatório PDF

### GET `/clients/:clientId/report?month=YYYY-MM` _(ORG_ADMIN | ORG_MANAGER)_
Retorna `Content-Type: application/pdf`. Cache Redis 1h.

**Removido em 2026-06-28** — endpoint não existe mais nesta versão da API
(Chromium/Puppeteer inflava a imagem Docker). Reimplementação futura
planejada com abordagem mais leve.

---

## Segurança

- JWT RS256, access 15min, refresh 7d (Redis)
- Middleware `verifyOrg`: `organizationId` do token deve corresponder ao recurso
- Middleware `checkPlanLimit`: valida limite de clientes antes de criar
- Middleware `checkSubscription`: bloqueia mutações se `subscriptionStatus = SUSPENDED`
- Rate limiting: 100 req/min por IP
- Senhas: bcrypt cost 12
- SMTP pass: AES-256 em repouso no banco
- URLs de anexo: assinadas com TTL 1h