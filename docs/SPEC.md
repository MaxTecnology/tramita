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

### GET `/clients` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
### POST `/clients` _(ORG_ADMIN | ORG_MANAGER)_
```json
{
  "name": "string", "clientType": "PF | PJ", "cnpj": "string?", "cpf": "string?",
  "codigo": "string?",
  "whatsapp": "string?", "phone": "string?", "notes": "string?",
  "cep": "string?", "estado": "string?", "cidade": "string?", "bairro": "string?",
  "logradouro": "string?", "numero": "string?", "complemento": "string?",
  "clientUsers": [
    { "existingId": "string", "departmentIds": ["string"] },
    { "name": "string", "email": "string", "password": "string", "departmentIds": ["string"] }
  ]
}
```
→ `codigo` é um identificador curto opcional que o escritório escolhe pra localizar o cliente rapidamente (ex.: código do sistema de gestão interno); aparece na listagem/busca de clientes e é usado como prefixo do título do board quando uma Solicitação é aprovada com `NEW_BOARD` (`"<codigo> - <nome> — <template>"`)
→ Middleware `checkPlanLimit` valida `clientsCount < plan.maxClients` antes de criar
→ `email`/`password` não existem mais direto no `Client` — o login do portal é do `ClientUser`, não da empresa. `clientUsers` é obrigatório (mínimo 1 item), cada item vincula um `ClientUser` existente (`existingId`) ou cria um novo (`name`/`email`/`password`), sempre com `departmentIds` (mínimo 1) definindo o escopo de acesso daquele usuário àquele cliente

### PATCH `/clients/:id` — mesmo payload, todos os campos opcionais; `clientUsers` quando enviado substitui os vínculos existentes
### DELETE `/clients/:id` — soft delete (não conta no limite ao desativar)

### GET `/clients/lookup-cnpj/:cnpj` _(ORG_ADMIN | ORG_MANAGER)_ — consulta a API pública do CNPJ.ws e retorna razão social + endereço pra preencher o formulário de cadastro
→ Sem autenticação própria, proxied pelo backend (`src/lib/cnpjws.ts`) pra evitar CORS e centralizar o tratamento de erro
→ Limite de 3 requisições/minuto por IP no plano gratuito da API pública — mapeado pra 429 com mensagem amigável

### GET `/clients/search-users` _(ORG_ADMIN | ORG_MANAGER)_ — `?q=` busca `ClientUser` da org por nome/email, pra reaproveitar um usuário já cadastrado ao vincular a um novo cliente
### GET `/clients/:id/users` _(ORG_ADMIN | ORG_MANAGER)_ — lista os `ClientUser` vinculados àquele cliente, com os departamentos de acesso de cada um

---

## Usuários de Cliente

`ClientUser` é a identidade de login do portal — uma pessoa, não uma empresa. Cada `ClientUser` pode ter acesso a mais de um `Client` (empresa), e o acesso a cada empresa é por departamento (`ClientUserAccess`: `clientUserId` + `clientId` + `departmentId`).

### GET `/client-users` _(ORG_ADMIN | ORG_MANAGER)_ — lista os `ClientUser` da org, com os clientes/departamentos que cada um acessa
### GET `/client-users/:id` _(ORG_ADMIN | ORG_MANAGER)_
### POST `/client-users` _(ORG_ADMIN | ORG_MANAGER)_
```json
{
  "name": "string", "email": "string", "password": "string", "phone": "string?", "isActive": true,
  "accesses": [{ "clientId": "string", "departmentId": "string" }]
}
```
→ `accesses` obrigatório (mínimo 1) — cada entrada é um par cliente+departamento que esse usuário pode ver no portal

### PATCH `/client-users/:id` _(ORG_ADMIN | ORG_MANAGER)_ — mesmo payload, todos os campos opcionais; `accesses` quando enviado substitui os vínculos existentes
### DELETE `/client-users/:id` _(ORG_ADMIN | ORG_MANAGER)_ — soft delete

### GET `/portal/clients` _(CLIENT)_ — `{ id, name }[]` — lista as empresas que o `ClientUser` logado pode acessar; usado pelo portal pra montar o seletor de empresa quando há mais de uma

---

## Boards

### GET `/boards` — ORG_ADMIN/MANAGER: todos | CLIENT: próprio
### GET `/boards/:id` — board com colunas e tarefas ordenadas por position
### POST `/boards` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "title": "string", "description": "string?", "clientId": "string", "osTemplateId": "string?" }
```
→ Sem `osTemplateId`: board nasce com as 3 colunas padrão (`Pendente`/`Em andamento`/`Concluído`)
→ Com `osTemplateId`: colunas do board são copiadas das colunas do `OSTemplate` (título, ordem, `statusEffect`, `notifyClient` e checklist de documentos) — cópia acontece uma vez na criação, sem vínculo vivo com o template depois
### PATCH `/boards/:id`

---

## Colunas

### POST `/boards/:boardId/columns` _(ORG_ADMIN | ORG_MANAGER)_
```json
{
  "title": "string", "color": "#hex?", "position": 0,
  "statusEffect": "NONE|OPEN|STARTED|BLOCKED|DISREGARDED|DONE",
  "notifyClient": false
}
```
→ `statusEffect` (padrão `NONE`): quando a tarefa entra nessa coluna, o `Task.status` é forçado pro valor configurado (exceto `NONE`, que não altera o status atual) — é assim que uma coluna "Fase" intermediária consegue marcar `STARTED` sem depender de `isFinal`, e uma coluna "Bloqueado" mantém `BLOCKED` mesmo movendo entre colunas do tipo Fase
→ `statusEffect: DONE` também dispara `TASK_COMPLETED`, igual ao antigo `isFinal: true`
→ `notifyClient` (padrão `false`): quando `true`, mover uma tarefa pra essa coluna dispara `TASK_MOVED` pro cliente mesmo que o toggle global "Tarefa movida" da organização esteja desligado — é uma notificação por coluna, não a notificação genérica de qualquer movimentação
→ Documentos vinculados à coluna (via Template de OS) viram `TaskDocumentRequirement` automaticamente na tarefa ao entrar na coluna, sem duplicar se ela passar pela mesma coluna mais de uma vez
### PATCH `/columns/:id`
### PATCH `/columns/reorder` — `[{ "id": "string", "position": 0 }]`
### DELETE `/columns/:id` _(ORG_ADMIN)_

---

## Templates de OS

`OSTemplate` define, de uma vez, o conjunto de colunas (com `statusEffect`/`notifyClient`/checklist de documentos) que um board `POST /boards` ou uma Solicitação aprovada com `NEW_BOARD` usa pra nascer já estruturado — sem precisar montar cada coluna manualmente depois. A cópia é feita uma vez na criação do board; editar o template depois não afeta boards já criados a partir dele.

### GET `/os-templates` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — lista templates da org, com colunas e documentos
### GET `/os-templates/:id` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
### POST `/os-templates` _(ORG_ADMIN)_
```json
{
  "name": "string",
  "description": "string?",
  "isActive": true,
  "columns": [
    {
      "title": "string",
      "statusEffect": "NONE|OPEN|STARTED|BLOCKED|DISREGARDED|DONE",
      "notifyClient": false,
      "documents": [{ "name": "string" }]
    }
  ]
}
```
→ `columns` obrigatório, mínimo 1 item — ordem do array vira `position`
### PATCH `/os-templates/:id` _(ORG_ADMIN)_ — mesmo payload, todos os campos opcionais; `columns` quando enviado substitui a lista inteira (delete + recreate, não diff incremental)
### DELETE `/os-templates/:id` _(ORG_ADMIN)_ — soft delete (`isActive: false`)

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
→ Dispara `TASK_MOVED` (com canais `WHATSAPP`+`EMAIL` forçados se `Column.notifyClient: true`, independente do toggle global da org). Se `Column.statusEffect: DONE` → também aplica o status na tarefa e dispara `TASK_COMPLETED`
→ Status possíveis (`TaskStatus`): `OPEN` (padrão) | `STARTED` (em andamento, atribuído por coluna com `statusEffect: STARTED`) | `BLOCKED` (impedimento, geralmente por checklist de documento pendente/rejeitado) | `DISREGARDED` (desconsiderada) | `DONE` (concluída)

### PATCH `/tasks/reorder` — `[{ "id": "string", "position": 0, "columnId": "string" }]`
### DELETE `/tasks/:id` _(ORG_ADMIN | ORG_MANAGER)_
### GET `/boards/:id/tasks/search?q=&priority=&assigneeId=&status=&dueBefore=&dueAfter=`

### GET `/tasks` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — listagem flat de tarefas atravessando todos os boards da org, inclusive o board oculto `RECURRING_SYSTEM` onde moram as Tarefas Recorrentes
**Query:** `?clientId=&assigneeId=&departmentId=&status=OPEN|STARTED|DONE|DISREGARDED|BLOCKED&recurringTemplateId=&dateFrom=&dateTo=&q=`
→ `dateFrom`/`dateTo` filtram por `targetDate`
→ `ORG_MEMBER` sempre vê só as próprias tarefas (`assigneeId` forçado ao próprio id, independente do que vier na query)
→ Usado pela tela unificada Tarefas (Lista/Kanban) pra cruzar tarefas de clientes diferentes agrupadas por status

**Response:** `Task[]`, cada item com `{ id, title, description, status, priority, position, columnId, assigneeId, creatorId, sourceRequestId, departmentId, tags, competence, targetDate, dueDate, recurringTemplateId, visibleToClient, createdAt, updatedAt, department: { id, name }, assignee: { id, name } | null, column: { board: { id, clientId, client: { id, name, codigo } } } }`, ordenado por `targetDate` ascendente

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

## Tarefas Recorrentes

### GET `/recurring-templates` _(ORG_ADMIN | ORG_MANAGER)_ — lista templates da org, com listas de documento a pedir/entregar
### GET `/recurring-templates/:id` _(ORG_ADMIN | ORG_MANAGER)_
### POST `/recurring-templates` _(ORG_ADMIN)_
```json
{
  "departmentId": "string",
  "title": "string",
  "description": "string?",
  "periodicity": "WEEKLY|MONTHLY|QUARTERLY|ANNUAL",
  "dueMonthOffset": 0,
  "dueDayOfPeriod": 1,
  "dueBusinessDayRoll": "NONE|FORWARD|BACKWARD",
  "targetOffsetDays": 0,
  "targetBusinessDayRoll": "NONE|FORWARD|BACKWARD",
  "generationMonthOffset": 1,
  "generationDayOfPeriod": 1,
  "autoCompleteOnAllActivitiesDone": false,
  "notifyViaWhatsapp": true,
  "notifyViaEmail": false,
  "visibleToClient": true,
  "isActive": true,
  "documentRequests": [{ "name": "string" }],
  "documentDeliveries": [{ "name": "string" }]
}
```
### PATCH `/recurring-templates/:id` _(ORG_ADMIN)_ — mesmo payload, todos os campos opcionais
### DELETE `/recurring-templates/:id` _(ORG_ADMIN)_ — 409 se houver vínculo de cliente ativo

### GET `/recurring-templates/:id/assignments` _(ORG_ADMIN | ORG_MANAGER)_ — lista vínculos de cliente do template
### POST `/recurring-templates/:id/assignments` _(ORG_ADMIN)_
```json
{ "clientId": "string", "boardId": "string", "columnId": "string" }
```
→ 409 se o cliente já estiver vinculado a este template
### PATCH `/recurring-templates/:id/assignments/:assignmentId` _(ORG_ADMIN)_ — `{ "boardId": "string?", "columnId": "string?", "isActive": "boolean?" }`
### DELETE `/recurring-templates/:id/assignments/:assignmentId` _(ORG_ADMIN)_

### POST `/recurring-templates/:id/assignments/:assignmentId/generate` _(ORG_ADMIN)_ — geração manual, fora do gatilho diário
```json
{ "competence": "ISO8601?" }
```
→ Sem `competence`, usa o início do período corrente; com `competence`, o valor é canonicalizado pro início do período (semana/mês/trimestre/ano) a que pertence, pra bater com a chave de idempotência do cron
→ 409 se já existe geração `SUCCESS` pra essa competência+cliente

### GET `/recurring-templates/:id/generation-log` _(ORG_ADMIN | ORG_MANAGER)_ — histórico de gerações (SUCCESS/FAILED) por competência

---

## Solicitações — Escritório

Contraparte, do lado do escritório, das Solicitações abertas pelo cliente no portal (ver `POST /portal/requests`).

### GET `/requests` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — `?status=PENDING|APPROVED|REJECTED|CANCELLED`
### GET `/requests/pending-count` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — `{ count: number }`
### GET `/requests/:id` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
### GET `/requests/stream?token=<accessToken>` — SSE, evento `request:changed` (sem payload) a cada mutação de Solicitação da org
### POST `/requests/:id/approve` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "mode": "EXISTING_BOARD", "boardId": "string", "columnId": "string" }
```
ou
```json
{ "mode": "NEW_BOARD" }
```
→ `EXISTING_BOARD`: cria a tarefa direto na coluna informada de um board já existente do cliente
→ `NEW_BOARD`: cria um board novo pro cliente antes de criar a tarefa — se a `Request` tiver `osTemplateId` (escolhido pelo cliente em `POST /portal/requests`, ver `GET /portal/os-templates`), o board nasce com as colunas desse template (igual a `POST /boards` com `osTemplateId`) e o título do board vira `"<codigo do cliente> - <nome do cliente> — <nome do template>"`; sem `osTemplateId`, o board nasce com as 3 colunas padrão e o título é o próprio título da Solicitação
### POST `/requests/:id/reject` _(ORG_ADMIN | ORG_MANAGER)_
```json
{ "reason": "string?" }
```

---

## Checklist de Documentos da Tarefa

### GET `/tasks/:id/documents` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — lista `requirements` (a pedir) e `deliverables` (a entregar), cada um com `signedUrl` do anexo quando houver
### POST `/tasks/:id/documents/requests` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — adiciona item ad-hoc à lista de documentos a pedir — `{ "name": "string" }` — recalcula o status da tarefa (BLOCKED enquanto houver item PENDING/REJECTED)
### POST `/tasks/:id/documents/deliveries` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — adiciona item ad-hoc à lista de documentos a entregar — `{ "name": "string" }`
### PATCH `/tasks/:id/documents/requests/:reqId` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — aprova/rejeita documento enviado
```json
{ "decision": "APPROVED|REJECTED", "rejectionReason": "string?" }
```
→ `rejectionReason` obrigatório quando `decision: REJECTED`
→ Rejeição dispara `DOCUMENT_REJECTED`
### POST `/tasks/:id/documents/requests/:reqId/upload` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — multipart, max 20MB — upload do lado do escritório pra um item a pedir
### POST `/tasks/:id/documents/deliveries/:reqId/upload` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — multipart, max 20MB — entrega de documento gerado pelo escritório

---

## Portal do Cliente — Documentos da Tarefa

### GET `/portal/tasks/:taskId/documents` _(CLIENT)_ — mesmo formato de `GET /tasks/:id/documents`; 404 se a tarefa não pertence ao cliente ou não é `visibleToClient`
### POST `/portal/tasks/:taskId/documents/requests/:reqId/upload` _(CLIENT)_ — multipart, max 20MB — cliente envia o documento pedido pelo escritório

---

## Portal do Cliente — Perfil e Solicitações

`request.user.sub` nas rotas de portal é o id do `ClientUser` (a pessoa logada), não de um `Client`. Rotas que tocam dado de empresa (`requests`, `tasks`, `documents`) exigem `clientId` explícito (body ou query) e validam contra o escopo de acesso do `ClientUser` (`getClientAccessScope`) — 404 se o `ClientUser` não tiver acesso àquele `clientId`.

### GET `/portal/profile` _(CLIENT)_ — dados do `ClientUser` logado
### PATCH `/portal/profile` _(CLIENT)_
```json
{ "password": "string?", "phone": "string?" }
```
→ `phone` (não mais `whatsapp`) — regex `\d{10,15}`

### GET `/portal/clients` _(CLIENT)_ — `{ id, name }[]` — empresas acessíveis pelo `ClientUser` logado

### GET `/portal/departments` _(CLIENT)_ — departamentos da organização, pra o formulário de nova solicitação

### GET `/portal/os-templates` _(CLIENT)_ — `{ id, name }[]` — templates de OS ativos da organização, pra o cliente escolher o tipo de solicitação no formulário de nova Solicitação

### GET `/portal/requests` _(CLIENT)_ — `?clientId=` **obrigatório** — 400 se ausente, 404 se o `ClientUser` não tem acesso àquele `clientId`
### POST `/portal/requests` _(CLIENT)_
```json
{
  "clientId": "string", "title": "string", "description": "string?", "departmentId": "string?",
  "osTemplateId": "string?"
}
```
→ `osTemplateId` (opcional) é o tipo de solicitação escolhido pelo cliente (ver `GET /portal/os-templates`) — fica salvo na `Request` e é usado por `POST /requests/:id/approve` quando o escritório aprova em modo `NEW_BOARD`
→ `clientId` **obrigatório** no body — 404 se o `ClientUser` não tem acesso àquele `clientId`

### GET `/portal/requests/:id` _(CLIENT)_
### PATCH `/portal/requests/:id/cancel` _(CLIENT)_
### POST `/portal/requests/:id/attachments` _(CLIENT)_ — multipart, max 20MB

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