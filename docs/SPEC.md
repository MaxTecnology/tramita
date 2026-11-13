# API Spec — Tramita

## Base URL: `/api/v1`

---

## Regras transversais (2026-11-12)

- **Uploads** (anexos, entregas, substituir protocolo, comprovante, uploads do portal): um único arquivo
  por requisição, campos de texto **antes** do arquivo, limite 20MB (413 em pt-BR). O tipo é decidido
  pela **extensão** numa lista permitida — PDF, JPG/JPEG, PNG, GIF, WEBP, DOC/DOCX, XLS/XLSX, TXT, CSV,
  XML, OFX, ZIP — e nunca pelo `Content-Type` do navegador; fora da lista → 422. XML, Office e ZIP são
  gravados no B2 com `Content-Disposition: attachment` (baixam, não abrem no navegador).
- **Escopo do colaborador** (2026-11-13, `src/modules/staff-scope/`): o colaborador pertence a
  departamentos (`UserDepartment`). **ORG_ADMIN** vê tudo; **ORG_MANAGER** vê tudo dos clientes
  atendidos pelos departamentos dele; **ORG_MEMBER** vê a carteira (responsável pelo processo, pelo
  cliente, ou com tarefa atribuída) **+** o mesmo que o gerente quando `seesDepartmentWork` está ligado
  (padrão). Vale para processos, tarefas, solicitações (e comentários), fila do robô, protocolos, guias,
  dashboard, contador de pendentes e SSE. Fora do escopo → **404**. Visível mas não é do colaborador
  (tarefa de colega vista pelo departamento) → só ver e comentar; mexer → **403** `Assuma a tarefa para
  alterá-la`. Listas aceitam `?scope=mine|department|all` (+ `departmentId`); sem `scope`: `department`
  para a equipe, `all` para o admin; `all` só vale para o admin.
- **Responsável** por cliente/departamento precisa pertencer ao departamento (admin isento); tirar alguém
  de um departamento onde é responsável → 409.
- **Rate limit** global por IP: `RATE_LIMIT_MAX` requisições/minuto (padrão 100).

## Assumir tarefa e escopo (2026-11-13)

- `POST /tasks/:id/assume` `{ expectedAssigneeId: string | null }` — staff do departamento da tarefa
  (Membro com "ver colegas"); só se o responsável ainda for o esperado (409 `Essa tarefa já foi assumida
  por outra pessoa`); tarefa concluída → 409; histórico `assumed`; aviso `TASK_ASSUMED` ao anterior.
- `POST /tasks/assume-bulk` `{ fromUserId, departmentId? }` → `{ count }` — todas as abertas do colega
  nos meus departamentos; um aviso só.
- `PATCH /tasks/:id` com `assigneeId` por Membro: só para alguém do departamento da tarefa (400).
- `GET /tasks`, `GET /boards/:id`: cada tarefa traz `viewerCanEdit`.
- `GET /users/me`: `role`, `departments[]`, `seesDepartmentWork`. `POST/PATCH /users`: `departmentIds`
  (obrigatório para gerente/colaborador) e `seesDepartmentWork`. `GET /users/options?departmentId=`:
  `{ id, name, role, departmentIds }`.
- Solicitações: Membro aprova/recusa/pede informação dentro do escopo; quem aprova e pertence ao
  departamento recebe a tarefa.
- Leitor de documentos: upload e documentos não identificados só para admin e gerente.

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
**Query:** `?clientId=&assigneeId=&departmentId=&status=OPEN|STARTED|DONE|DISREGARDED|BLOCKED&recurringTemplateId=&dateFrom=&dateTo=&dateField=target|effective&q=`
→ `dateFrom`/`dateTo` filtram por `targetDate` quando `dateField` é omitido ou `target` (padrão, usado por Lista/Kanban)
→ `dateField=effective` filtra por `targetDate` OU, quando `targetDate` é `null`, por `dueDate` — usado pelo modo Calendário pra incluir tarefas de processo comuns (que não têm `targetDate`) na janela do mês visível
→ `ORG_MEMBER` sempre vê só as próprias tarefas (`assigneeId` forçado ao próprio id, independente do que vier na query)
→ Usado pela tela unificada Tarefas (Lista/Kanban/Calendário) pra cruzar tarefas de clientes diferentes agrupadas por status

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
  "priority": "LOW|MEDIUM|HIGH|URGENT",
  "dueDayOfPeriod": 1,
  "dueBusinessDayRoll": "NONE|FORWARD|BACKWARD",
  "competenceMonthOffset": 1,
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
→ Vencimento é a âncora: `dueDayOfPeriod`/`dueBusinessDayRoll` definem o vencimento dentro do mês de vencimento; `competenceMonthOffset` deriva a competência subtraindo esse número de meses do mês de vencimento (exceto WEEKLY, onde a competência É a segunda-feira da semana — não há mês de vencimento isolado)
### PATCH `/recurring-templates/:id` _(ORG_ADMIN)_ — mesmo payload, todos os campos opcionais
### DELETE `/recurring-templates/:id` _(ORG_ADMIN)_ — 409 se houver vínculo de cliente ativo

### GET `/recurring-templates/:id/assignments` _(ORG_ADMIN | ORG_MANAGER)_ — lista vínculos de cliente do template — `?q=` filtra por nome do cliente
### POST `/recurring-templates/:id/assignments` _(ORG_ADMIN)_
```json
{ "clientId": "string" }
```
→ 409 se o cliente já estiver vinculado a este template
### PATCH `/recurring-templates/:id/assignments/:assignmentId` _(ORG_ADMIN)_ — `{ "isActive": "boolean?" }`
### DELETE `/recurring-templates/:id/assignments/:assignmentId` _(ORG_ADMIN)_

### POST `/recurring-templates/:id/assignments/:assignmentId/generate` _(ORG_ADMIN)_ — geração manual, fora do gatilho diário
```json
{ "dueMonth": "ISO8601?" }
```
→ `dueMonth` é o mês de VENCIMENTO (âncora), não a competência — a competência é derivada dele via `competenceMonthOffset` (WEEKLY: `dueMonth` já é a própria competência/semana). Sem `dueMonth`, usa o próximo ciclo normal do template (o que o cron geraria no próximo disparo); com `dueMonth`, o valor é canonicalizado pro início do período (semana/mês/trimestre/ano) a que pertence, pra bater com a chave de idempotência do cron
→ 409 se já existe geração `SUCCESS` pra essa competência+cliente

### GET `/recurring-templates/:id/generation-log` _(ORG_ADMIN | ORG_MANAGER)_ — histórico de gerações (SUCCESS/FAILED) por competência

### POST `/recurring-templates/:id/assignments/bulk-generate` _(ORG_ADMIN)_ — geração manual em lote, pra um template e uma lista de vínculos escolhidos na tela
```json
{ "dueMonth": "ISO8601", "assignmentIds": ["string"] }
```
→ `dueMonth` é sempre o mês de vencimento escolhido no seletor da tela (não a competência) — ver nota do endpoint de geração manual acima. Pra templates WEEKLY, gera uma Task por cada segunda-feira contida no mês escolhido (não apenas uma semana)
→ Resposta: `{ "generated": number, "alreadyExists": number, "failed": [{ "clientName": "string", "errorMessage": "string" }] }` — uma falha isolada (ID inválido, erro de negócio, exceção pontual) nunca derruba o lote inteiro; cada item entra no balde correspondente
### POST `/recurring-templates/bulk-generate` _(ORG_ADMIN)_ — mesma geração em lote, porém pra TODOS os templates ativos da organização de uma vez (console global), cada um com seus próprios vínculos ativos
```json
{ "dueMonth": "ISO8601" }
```
→ Resposta: `[{ "templateId": "string", "templateTitle": "string", "result": <mesmo formato de bulk-generate acima> }]` — um item por template ativo da org, mesmo os sem vínculo (0 geradas)
### GET `/recurring-templates/failed-generations` _(ORG_ADMIN | ORG_MANAGER)_ — lista todas as gerações `FAILED` da org, com nome do cliente resolvido
→ Resposta: `[{ "templateId": "string", "templateTitle": "string", "clientId": "string", "clientName": "string", "competence": "ISO8601", "dueMonth": "ISO8601", "retryable": boolean, "errorMessage": "string", "createdAt": "ISO8601" }]`
→ `dueMonth` é o mês de vencimento que gerou aquela competência (derivado via `competenceMonthOffset`) — usado pelo botão "Gerar novamente" da tela, que deve reenviar esse valor como `dueMonth` em `POST /:id/assignments/bulk-generate`, nunca a `competence` crua (regenerar com a competência errada gera uma tarefa já vencida)
→ `retryable: false` quando o cliente não está mais vinculado (ativo) a esse template — a tela deve desabilitar/explicar o botão de retry nesse caso em vez de permitir uma tentativa que nunca resolve a falha

---

## Solicitações — Escritório

Contraparte, do lado do escritório, das Solicitações abertas pelo cliente no portal (ver `POST /portal/requests`).

### GET `/requests` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — `?status=PENDING|APPROVED|REJECTED|CANCELLED`
### GET `/requests/pending-count` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — `{ count: number }`
### GET `/requests/:id` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
### GET `/requests/stream?ticket=<ticket>` — SSE, evento `request:changed` (sem payload) a cada mutação de Solicitação da org
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
### POST / DELETE `/portal/tasks/:taskId/documents/requests/:reqId/not-applicable` _(CLIENT)_ — "Nada a enviar" (PENDING/REJECTED → `NOT_APPLICABLE`, conta como resolvido igual APPROVED) e desfazer (volta a PENDING; 409 `'A tarefa já foi concluída'` se a tarefa está DONE). O escritório pode recusar um `NOT_APPLICABLE` via `PATCH /tasks/:id/documents/requests/:reqId` `{ decision: 'REJECTED', rejectionReason }`.

---

## Portal do Cliente — Documentos recebidos, Início e Enviar documentos (2026-11-12)

Portal centrado em documentos (spec `docs/superpowers/specs/2026-11-12-portal-cliente-documentos-design.md`). Todo documento que o cliente recebe é um `Protocol`; a entrega (`TaskDeliverable`) concluída numa tarefa `visibleToClient` gera/atualiza o protocolo dela (1:1, `Protocol.deliverableId`). Documento enviado **nunca some** se a tarefa for ocultada depois; só o cancelamento (exceção) o tira do portal. Valores trafegam como string decimal com ponto (`"1234.56"`); o front converte do formato brasileiro.

### GET `/portal/home?clientId=` _(CLIENT)_ — `{ unpaidGuides: { count, overdueCount }, documentsToSend, documentsToSendInProcesses, processesInProgress, dueThisWeek: { kind: 'guide'|'request', id, title, dueDate, amount? }[], unreadMessages: { count, link|null }, pendingApprovals, pendingApprovalLink|null }` — tudo no escopo de departamento do usuário. `unreadMessages.count` = conversas (tarefas) com comentário do escritório não lido no sino; `link` abre a mais antiga. `pendingApprovalLink` abre a aprovação pendente mais antiga
### GET `/portal/protocols?clientId=&search=&competence=AAAA-MM&departmentId=&dueFrom=&dueTo=&paymentStatus=unpaid|paid` _(CLIENT)_ — lista sem `content`; inclui `competence, requiresPayment, amount, paidAt, paidAmount, fileUpdatedAt, departmentName`; exclui cancelados
### GET `/portal/protocols/:id` _(CLIENT)_ — registra `VIEWED`; devolve detalhe + `events` (`type, actorName, detail, createdAt`), `paidBy`, `paymentProof`. 404 fora do escopo ou cancelado
### POST `/portal/protocols/:id/pay` _(CLIENT)_ — JSON `{ amount }` ou multipart (`amount` antes do arquivo + comprovante opcional). Só em guia (`requiresPayment`, senão 422); 409 se já paga (escrita guardada: clique duplo gera um só `PAID`); marca `VIEWED` se ainda não visto
### DELETE `/portal/protocols/:id/pay` _(CLIENT)_ — desfaz (evento `UNPAID`); comprovante fica no histórico de anexos
### GET `/portal/document-requests/months?clientId=` _(CLIENT)_ — `{ competence: 'AAAA-MM', pending, total }[]` desc — meses com tarefa recorrente visível (board `RECURRING_SYSTEM`) que tenha pedido de documento, conversa ou aprovação; `pending/total` contam só os pedidos
### GET `/portal/document-requests?clientId=&competence=AAAA-MM` _(CLIENT)_ — agrupado por tarefa: `{ competence, tasks: { taskId, title, departmentName, requests: { id, taskId, name, status, rejectionReason, taskTitle, departmentName }[], approvals: Approval[], unreadMessages }[] }`. Tarefa recorrente visível aparece se tiver pedido, comentário ou aprovação; sem nada, não aparece

## Escritório — guias e ações no documento enviado (2026-11-12)

### POST `/tasks/:id/documents/deliveries` — body `{ name, requiresPayment? }`
### POST `/tasks/:id/documents/deliveries/:reqId/upload` — multipart: `amount` (obrigatório se a entrega exige pagamento → 400 `'Informe o valor da guia'`), `paymentDueDate` (AAAA-MM-DD, padrão = prazo da tarefa) **antes** do arquivo. Gera/atualiza o protocolo e avisa o cliente (`PROTOCOL_CREATED`, variável `{{paymentInfo}}` com valor e vencimento). Reentregar guia já paga → 409
### POST `/tasks/:taskId/protocols` — aceita também `requiresPayment`, `amount`; grava `competence` da tarefa
### POST `/protocols/:id/replace` — multipart (arquivo + `amount?`/`paymentDueDate?`): substitui o arquivo no mesmo protocolo (evento `REPLACED` com `previousAttachmentId`), cliente é avisado de novo; 409 se paga ou cancelada
### PATCH `/protocols/:id/payment` — `{ amount?, dueDate? }` (evento `AMOUNT_CHANGED` com antes → depois); 409 se paga
### POST `/protocols/:id/cancel` — `{ reason }` (mín. 3): exceção (ex.: enviado ao cliente errado); sai do portal e dos indicadores; nunca apaga
### GET `/protocols/unpaid?clientId=&departmentId=&competence=AAAA-MM&situation=overdue|upcoming|paid` — guias não pagas (vencidas primeiro, por vencimento) ou pagas (`paidByName`, `paidAmount`)
### GET `/protocols/unpaid/summary` — `{ unpaidCount, unpaidTotal, overdueCount, overdueTotal }` (totais string decimal) — cartão "Guias não pagas" do Dashboard
### Robô (`POST /document-reader/:id/confirmar` e `/trocar-tarefa`) — body aceita `{ deliverableId?, amount?, paymentDueDate? }`. Toda anexação confere CNPJ e competência (AAAA-MM) com a tarefa (422 se não bater); o documento preenche a entrega pendente (uma só: automática; várias: o revisor escolhe) com valor/vencimento lidos (campos `valor` tipo moeda e `vencimento` tipo data) ou informados

Visibilidade do `ORG_MEMBER` nessas rotas e em `GET /protocols`/`summary`: `memberBoardWhere` (responsável do processo, responsável de departamento que atende o cliente, ou com tarefa atribuída).

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
  "taskBlocked": true,
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

## Central de notificações (sino) — equipe e cliente

Uma linha por destinatário em `in_app_notifications` (`recipientUserId` **ou** `recipientClientUserId`, CHECK no banco), sempre gravada, independente dos toggles de WhatsApp/e-mail. Quem causou o evento não recebe. Cliente: só usuários com acesso à empresa **e** ao departamento do item; tarefa interna (`visibleToClient=false`) nunca notifica o cliente. Emissores em `src/modules/inbox/inbox-events.ts` (falha no sino é logada, nunca derruba a ação).

Destinatário pelo papel do token (CLIENT → usuário do cliente; equipe → usuário). Cada um só lê/marca as próprias (404 nas dos outros).

### GET `/notifications` _(equipe | CLIENT)_
**Query:** `?status=all|read|unread&type=<InAppType>&clientId=&from=AAAA-MM-DD&to=AAAA-MM-DD&q=&cursor=&limit≤50` → `{ items: InAppNotification[], nextCursor|null }` (mais recente primeiro)
### GET `/notifications/unread-count` → `{ count }`
### POST `/notifications/:id/read` · POST `/notifications/:id/unread` → `{ ok: true }`
### POST `/notifications/read-all` → `{ count }`
### POST `/notifications/read-by-task` `{ taskId }` → `{ count }` — usado ao abrir a conversa da tarefa no portal

**Tipos (`InAppType`) e destinatários:**
| Tipo | Quem recebe | Link |
|---|---|---|
| `TASK_COMMENT` | responsável da tarefa (ou do departamento) quando cliente/colega comenta; usuários do cliente quando o escritório comenta | equipe `/app/tasks?task=` (recorrente) ou `/app/board/<id>?task=`; cliente `/portal/send?competence=AAAA-MM&task=` ou `/portal/board/<id>?task=` |
| `REQUEST_CREATED` | responsável do departamento | `/app/requests?request=` |
| `REQUEST_COMMENT` | nos dois sentidos | `/app/requests?request=` · `/portal/requests?request=` |
| `REQUEST_STATUS` | usuários do cliente (aprovada, recusada, precisa de info, cancelada) | `/portal/requests?request=` |
| `DOCUMENT_UPLOADED` | responsável da tarefa | tarefa (equipe) |
| `DOCUMENT_REJECTED` | usuários do cliente | tarefa (cliente) |
| `DOCUMENT_RECEIVED` | usuários do cliente (protocolo novo) | `/portal/documents/<protocolo>` |
| `APPROVAL_REQUESTED` | usuários do cliente | tarefa (cliente) |
| `APPROVAL_DECIDED` | quem pediu + responsável da tarefa | tarefa (equipe) |
| `TASK_ASSUMED` | responsável anterior (em lote: 1 linha resumida) | tarefa / `/app/tasks` |
| `TASK_ASSIGNED` | novo responsável (criação por pessoa, edição, transferência em lote resumida) — geração automática de recorrentes não notifica | tarefa / `/app/tasks` |
| `BOARD_ASSIGNED` | responsável do processo novo | `/app/board/<id>` |

`GET /tasks?taskId=<id>` (equipe) devolve só essa tarefa, ignorando os filtros da tela e respeitando o escopo — usado pelo link da notificação. Os itens da lista trazem `awaitingApproval`.

---

## Aprovação do cliente (`task_approvals`)

`Approval = { id, taskId, title, message, status: PENDING|APPROVED|CHANGES_REQUESTED|CLOSED_BY_OFFICE, requestedAt, requestedByName, decidedAt, decisionNote, closeReason: APPROVED_OUTSIDE|NO_RESPONSE|null, waitedDays, decidedByName, decidedByClient, fileName, fileUrl (assinada), proofName, proofUrl }`

### POST `/tasks/:id/approvals` _(equipe, multipart: `title`, `message?` antes do arquivo `file`)_ → 201 `Approval`
Tarefa fora do escopo → 404; tarefa interna → 422 `Só tarefas visíveis ao cliente podem pedir aprovação`; encerrada → 409. Histórico `approval_requested`; aviso `APPROVAL_REQUESTED` (WhatsApp/e-mail, toggle `approvalRequested`) + sino.
### GET `/tasks/:id/approvals` _(equipe)_ → `Approval[]`
### POST `/approvals/:id/close` _(equipe)_ — JSON `{ reason, note }` ou multipart com os mesmos campos antes do `file` (print opcional)
`note` obrigatória nos dois motivos. Exige poder mexer na tarefa (fora do escopo 404; só vê → 403 `Assuma a tarefa para alterá-la`). Grava `decidedByUserId`, `decidedAt`, `waitedDays` (dias inteiros desde o pedido). Histórico `approval_closed_by_office`.
### GET `/portal/tasks/:taskId/approvals` _(CLIENT)_ → `Approval[]` (fora da empresa/departamento → 404)
### POST `/portal/approvals/:id/approve` _(CLIENT)_ `{ note? }` · POST `/portal/approvals/:id/request-changes` _(CLIENT)_ `{ note }` (obrigatória)
Histórico `approval_approved` / `approval_changes_requested`; pedido de ajuste avisa quem pediu (`APPROVAL_CHANGES_REQUESTED`, toggle `approvalChangesRequested`); sino `APPROVAL_DECIDED`.

**Regras:** decisão e fechamento são escritas protegidas (`updateMany` com `status: PENDING`) — quem chega depois recebe 409 `Essa aprovação já foi <aprovada pelo cliente | respondida com pedido de ajuste | fechada pelo escritório>`. Com aprovação `PENDING` a tarefa não conclui (409 `Há aprovação do cliente pendente`) por `PATCH /tasks/:id`, por mover para coluna `DONE` nem pela conclusão automática do checklist. Decidir/fechar recalcula o status (a conclusão automática pode acontecer em seguida).

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

### POST `/stream/ticket`

Autenticado por header (`Authorization: Bearer <accessToken>`, qualquer perfil). Devolve
`{ "ticket": "<aleatório>" }`, guardado no Redis (`sse-ticket:<ticket>`) por **30s** e **de uso
único**: a rota de stream consome (`GETDEL`) na conexão. O `EventSource` não manda header, então o
JWT nunca vai na URL — o que aparece em log de proxy/histórico é um ticket já inútil. O web pede um
ticket novo a cada (re)conexão. `?token=` não é mais aceito (401).

### GET `/boards/:id/stream?ticket=<ticket>`

401 sem ticket, ticket inválido/expirado/já usado. 404 se o processo não existe na org, se o
CLIENT não tem acesso à empresa ou se o ORG_MEMBER não enxerga o processo.

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