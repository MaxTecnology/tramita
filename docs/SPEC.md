# API Spec — Tramita

## Base URL

Rotas na raiz da API, sem prefixo de versão: produção `https://tramitaapi.autohubs.com.br`,
local `http://localhost:3000`.

## Documentação da API (2026-11-17)

- **Referência interativa (Scalar):** `GET /reference/` — opt-in: só com `API_DOCS_ENABLED=true` **e**
  `NODE_ENV !== 'production'` (senão a rota não existe, 404). Lista só o servidor local, para o "Try it"
  nunca chamar produção. A página roda sem o CSP do helmet (script inline do Scalar);
  todas as outras rotas mantêm o CSP.
- **Fonte:** `@fastify/swagger` coleta todas as rotas; resumo, descrição, body e query vêm do catálogo
  `apps/api/src/api-docs/` (chave `"MÉTODO /caminho/:param"`), usando os mesmos schemas Zod que os
  handlers validam. As rotas não recebem `schema` do Fastify: a validação continua no `safeParse` de
  cada handler (respostas 400 `{ message }` inalteradas).
- **Rota nova sem documentação quebra o teste** `src/plugins/openapi.test.ts` (toda operação precisa de
  entrada no catálogo; entrada sem rota também falha).
- **Arquivos gerados:** `pnpm --filter api docs:api` escreve `docs/api/openapi.json` e `docs/api/llms.md`
  (Markdown para agentes de IA). "Quem pode" (`x-roles` + linha na descrição) vem do probe de
  `pnpm --filter api audit:routes` — rodar o audit antes; sem o probe, ou com rota fora dele, o gerador
  falha. Papel checado dentro do service (o probe não enxerga, o body falha antes) é declarado no
  catálogo (`roles`), ex.: `POST /tasks/:id/release` → Admin, Gerente. O arquivo gerado tem `servers`
  fixos (produção + local), não depende de quem gerou.
- Schemas no dialeto do OpenAPI 3.1 (JSON Schema; `zod-to-json-schema` com `jsonSchema7`).
- Tags por primeiro segmento do caminho; segurança: `bearerAuth` em tudo, exceto as públicas
  (`[]`), o webhook (`asaas-access-token`) e os streams SSE (`?ticket=`).
- Ocultas do spec: `/reference`, preflight `OPTIONS` e o curinga `*`; a duplicata `/x/` de rotas `'/'`
  com prefixo é normalizada para `/x`.

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

→ Usuário da equipe desativado (`isActive=false`) não entra (401, como credencial inválida).
→ Senha errada conta por conta (e-mail): depois de `RATE_LIMIT_LOGIN_MAX` falhas (padrão 10) em 15 min → 429 `'Muitas tentativas de login. Tente de novo em alguns minutos.'`; login certo zera. E-mail inexistente faz a mesma conferência de senha (sem pista de tempo). Os limites por IP/usuário do plugin ficam no Redis.

### POST `/auth/refresh` — `{ "refreshToken": "string" }`
→ Equipe/Master: recarrega o usuário do banco — desativado → 401 (e as sessões dele caem); o novo access token sai com o papel e a organização **atuais** (um gerente rebaixado não mantém o papel antigo). CLIENT desativado → 401.
### POST `/auth/logout` — invalida refresh token no Redis
### POST `/auth/change-password` — `{ currentPassword, newPassword, keepRefreshToken? }`
→ Encerra as outras sessões da pessoa; mantém a do `keepRefreshToken` quando ele é dela.

**Web:** a sessão só é encerrada quando a API recusa a renovação (401/400); API fora do ar por um instante (deploy, rede, 5xx, 429) mantém a pessoa logada e as telas/streams tentam de novo.

**Sessões:** cada refresh token fica indexado por pessoa (`sessions:<id>` no Redis). Desativar alguém, mudar o papel de um usuário da equipe, o admin redefinir a senha (equipe), ou o escritório desativar/trocar a senha de um usuário do portal encerra todas as sessões abertas dele. Um access token já emitido vale até expirar (15 min).

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
→ Body: `{ planId?, subscriptionStatus?, manualNextDueDate?: 'AAAA-MM-DD' | null }`. `manualNextDueDate` só em escritório `billingMode: MANUAL` (422 `'Escritório cobrado pelo Asaas não tem vencimento manual'`).
#### POST `/master/organizations` — cadastro manual pelo Master (sem passar pelo `/organizations/register` público)
```json
{
  "name": "string",
  "email": "string",
  "phone": "string?",
  "cnpj": "string?",
  "planId": "string",
  "adminName": "string",
  "createAsaasSubscription": false,
  "manualNextDueDate": "AAAA-MM-DD?"
}
```
→ Cria Organization (`subscriptionStatus: ACTIVE` direto, sem trial) + User (ORG_ADMIN)
→ Senha do ORG_ADMIN é **gerada pelo servidor**, nunca definida no formulário — retorna `temporaryPassword` em texto puro só nesta resposta (não fica persistida em lugar nenhum)
→ `cnpj` só é obrigatório quando `createAsaasSubscription: true`; nesse caso cria Customer + Subscription no Asaas igual ao `/organizations/register` (com o mesmo rollback se a Asaas falhar)
→ `billingMode`: com assinatura no Asaas → `ASAAS`; sem → `MANUAL` (acerto direto com a AutoHubs; `manualNextDueDate` opcional, só lembrete no painel — nunca bloqueia). O webhook do Asaas só altera escritórios `ASAAS`. Lista e detalhe trazem `billingMode` e `manualNextDueDate`.

#### POST `/master/organizations/:orgId/users/:userId/reset-password` — redefine a senha de qualquer usuário da organização
→ Mesmo mecanismo de senha gerada do endpoint acima; retorna `{ id, name, email, temporaryPassword }`

#### GET `/master/revenue` — `{ mrr, mrrAsaas, mrrManual, totalOrgsAtivas, churn }` (MRR das orgs ACTIVE, separado por forma de cobrança)

---

## Escritórios — Cadastro Público

### GET `/organizations/signup-status` — `{ enabled: boolean }` (público)
→ `enabled` = `PUBLIC_SIGNUP_ENABLED === 'true'`. Desligado por padrão: a AutoHubs cadastra o escritório pelo Master e entrega o acesso; a tela `/register` mostra "Fale com a gente".

### POST `/organizations/register`
Cadastro de novo escritório (público — sem autenticação). Só com `PUBLIC_SIGNUP_ENABLED=true`; desligado → 404 `'Cadastro indisponível'`.
```json
{
  "name": "string",
  "cnpj": "string",
  "email": "string",
  "phone": "string?",
  "adminName": "string",
  "adminPassword": "string",
  "planId": "string"
}
```
→ Cria Organization + User (ORG_ADMIN) + Customer no Asaas + Subscription no Asaas
→ Sem trial público: `cnpj` obrigatório e `planId` precisa ser um plano ativo (`"trial"` → 400/404). Escritório cortesia ou com cobrança fora do Asaas é criado pelo Master (`POST /master/organizations`)
→ 201 `{ organization, user: { id, name, email, role } }` — nunca devolve o hash da senha

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
{ "title": "string", "description": "string?", "clientId": "string", "processTemplateId": "string?" }
```
→ Sem `processTemplateId`: board nasce com as 3 colunas padrão (`Pendente`/`Em andamento`/`Concluído`)
→ Com `processTemplateId`: colunas do board são copiadas das colunas do `OSTemplate` (título, ordem, `statusEffect`, `notifyClient` e checklist de documentos) — cópia acontece uma vez na criação, sem vínculo vivo com o template depois
### PATCH `/boards/:id`

---

## Colunas

Não há rota para criar, editar, reordenar ou remover colunas: elas nascem com o processo, copiadas do Modelo de Processo (ou as 3 padrão). Campos de cada coluna: `title`, `position`, `statusEffect` (`NONE|OPEN|STARTED|BLOCKED|DISREGARDED|DONE`), `notifyClient`.
→ `statusEffect` (padrão `NONE`): quando a tarefa entra nessa coluna, o `Task.status` é forçado pro valor configurado (exceto `NONE`, que não altera o status atual) — é assim que uma coluna "Fase" intermediária consegue marcar `STARTED` sem depender de `isFinal`, e uma coluna "Bloqueado" mantém `BLOCKED` mesmo movendo entre colunas do tipo Fase
→ `statusEffect: DONE` também dispara `TASK_COMPLETED`, igual ao antigo `isFinal: true`
→ `notifyClient` (padrão `false`): quando `true`, mover uma tarefa pra essa coluna dispara `TASK_MOVED` pro cliente mesmo que o toggle global "Tarefa movida" da organização esteja desligado — é uma notificação por coluna, não a notificação genérica de qualquer movimentação
→ Documentos vinculados à coluna (via Modelo de Processo) viram `TaskDocumentRequirement` automaticamente na tarefa ao entrar na coluna, sem duplicar se ela passar pela mesma coluna mais de uma vez

---

## Templates de OS

`OSTemplate` define, de uma vez, o conjunto de colunas (com `statusEffect`/`notifyClient`/checklist de documentos) que um board `POST /boards` ou uma Solicitação aprovada com `NEW_BOARD` usa pra nascer já estruturado — sem precisar montar cada coluna manualmente depois. A cópia é feita uma vez na criação do board; editar o template depois não afeta boards já criados a partir dele.

### GET `/process-templates` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — lista templates da org, com colunas e documentos
### GET `/process-templates/:id` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_
### POST `/process-templates` _(ORG_ADMIN)_
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
### PATCH `/process-templates/:id` _(ORG_ADMIN)_ — mesmo payload, todos os campos opcionais; `columns` quando enviado substitui a lista inteira (delete + recreate, não diff incremental)
### DELETE `/process-templates/:id` _(ORG_ADMIN)_ — soft delete (`isActive: false`)

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

**Responsável:** `assigneeId` (tarefa/OS) e `responsibleUserId` (processo) precisam ser de usuário ativo da equipe do mesmo escritório — outro escritório ou desativado → 404 `'Usuário não encontrado'` (nada é atribuído nem notificado).
**Tarefa para outro departamento:** quem pode alterar a tarefa (inclusive o membro com a tarefa dele) a passa para qualquer pessoa ativa da equipe, de qualquer departamento. A tarefa **continua no departamento dela** (filas e indicadores); quem recebe passa a vê-la e a ver o processo (contexto), mas só altera as tarefas que são dele; o gerente do outro departamento não passa a vê-la; o departamento de quem recebe não precisa atender o cliente. Ao concluir, fica com quem recebeu (o histórico mostra o caminho).

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
→ `{ content, isInternal? }`: `isInternal: true` (só a equipe; do cliente é ignorado) é nota interna — o cliente não a vê na lista, não pode removê-la (404), não recebe WhatsApp/e-mail nem sino, e ela não faz a tarefa aparecer em "Enviar documentos" do portal. A lista da equipe traz `isInternal`.
```json
{ "content": "string" }
```
→ Autor detectado pelo JWT (`userId` ou `clientId` + `organizationId`)
→ Dispara `TASK_COMMENT_ADDED`

### DELETE `/comments/:id` _(autor ou ORG_ADMIN)_

---

## Anexos

### POST `/tasks/:id/attachments` — multipart, max 20MB
→ Todo upload (anexo, documento, protocolo, comprovante, aprovação, solicitação, robô): o tipo vem da extensão (lista permitida) e o **conteúdo precisa conferir** com ela (assinatura do PDF/PNG/JPG/GIF/WEBP/Office/ZIP; texto sem bytes binários) — senão 422 `'O conteúdo do arquivo não confere com a extensão dele. Envie o arquivo original.'`
### GET `/tasks/:id/attachments` — lista com `signedUrl` TTL 1h
### DELETE `/tasks/:id/attachments/:attachmentId`
→ Arquivo que é registro de algo não é removido (409): o arquivo atual de um documento pedido ao cliente ("para trocar, envie outro"), de uma entrega, de um protocolo, o comprovante de pagamento, o lido pelo robô e os de aprovação. Versões antigas e anexos livres podem ser removidos.

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

### GET `/requests` _(ORG_ADMIN | ORG_MANAGER | ORG_MEMBER)_ — `?status=PENDING|APPROVED|REJECTED|CANCELLED` — cada item traz `processTemplate: { id, name } | null` (o modelo de processo que o cliente pediu)
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
→ `NEW_BOARD`: cria um board novo pro cliente antes de criar a tarefa — se a `Request` tiver `processTemplateId` (escolhido pelo cliente em `POST /portal/requests`, a partir do catálogo `GET /portal/services`), o board nasce com as colunas desse template (igual a `POST /boards` com `processTemplateId`) e o título do board vira `"<codigo do cliente> - <nome do cliente> — <nome do template>"`; sem `processTemplateId`, o board nasce com as 3 colunas padrão e o título é o próprio título da Solicitação
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
→ Documento já aprovado → 409 `'Este documento já foi aprovado pelo escritório'`; tarefa concluída/desconsiderada → 409 `'A tarefa já foi encerrada pelo escritório'`. A lista de documentos traz do arquivo só `id, filename, mimeType, size, reviewStatus, createdAt` e o `signedUrl` (nunca a chave do storage).
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
### Robô por entrega (2026-11-15) — a obrigação do robô fica em cada documento a entregar (`RecurringTaskTemplateDocument.obligationTypeId` → copiado para `TaskDeliverable.obligationTypeId`); o modelo de recorrente não tem mais obrigação própria. O robô casa o documento lido com a entrega pendente daquela obrigação e grava `ReceivedDocument.deliverableId`; confirmar preenche essa entrega (409 `'Essa entrega já foi feita'` se alguém entregou antes). Nunca entrega sozinho: tudo passa pela fila.
### GET `/document-reader/fila` — cada item traz `suggestion { taskId, taskTitle, clientName, competence, deliverableId, deliverableName, obligationName, requiresPayment, amount, paymentDueDate }`, `checks { cnpj, competence, payment }` (booleanos) e `ready` (sugestão única com tudo conferido)
### POST `/document-reader/confirmar-lote` — `{ ids: cuid[] (1..50) }` → `{ results: [{ id, ok, error? }], summary: { delivered, completed, readyTaskIds, failed } }`; falha de um item não desfaz os outros; `readyTaskIds` = tarefas com tudo entregue que pedem confirmação para concluir
### POST `/tasks/:id/documents/deliveries/:reqId/check` _(staff)_ — multipart só com o arquivo; entrega sem robô → `{ warnings: [], read: {} }`. Com robô → `{ blocked?, warnings: string[], read: { amount?, dueDate? } }`. `blocked` = CNPJ de **outro cliente do escritório** (`'Este documento é de X — não pode ser entregue a Y'`). Avisos: competência diferente (`'Competência do documento: MM/AAAA — a tarefa é de MM/AAAA'`), CNPJ fora da carteira, CNPJ não lido, tipo de documento diferente da obrigação, guia sem valor/vencimento lidos, arquivo não conferível (não-PDF ou não reconhecido)
### `POST .../deliveries/:reqId/upload` com robô — refaz a conferência: `blocked` → 422 (sem exceção); avisos sem o campo `acceptWarnings=true` → 409; com ele entrega e grava no histórico `deliverable_delivered_with_warnings` (`toValue` = `arquivo — avisos`). Valor/vencimento lidos preenchem a guia quando não informados

Visibilidade do `ORG_MEMBER` nessas rotas e em `GET /protocols`/`summary`: `memberBoardWhere` (responsável do processo, responsável de departamento que atende o cliente, ou com tarefa atribuída).

---

## Ordens de Serviço e Processos (2026-11-16)

Spec: `docs/superpowers/specs/2026-11-15-os-processos-design.md`. **OS** = uma tarefa criada de um **Modelo de OS** (avulsa no board `SERVICE_SYSTEM` do cliente, ou etapa de um processo). **Processo** = board `PROCESS` criado de um **Modelo de Processo** (colunas + OS que nascem nele, com dependências).

**Calendário**
### GET `/holidays?year=` → `{ national: {date,name}[], custom: {id,date,name}[] }` · POST `/holidays` `{ date: 'AAAA-MM-DD', name }` (ORG_ADMIN; 409 `'Já existe feriado nesta data'`) · DELETE `/holidays/:id`. Cadastrar ou remover feriado recalcula a meta das OS e processos abertos cuja janela (liberação/abertura → meta) cobre a data.
### GET `/holidays/days?from=AAAA&to=AAAA` (máx. 5 anos) → `string[]` com todos os dias de feriado (nacionais + do escritório). Dia útil = seg–sex menos esses dias; vale para recorrentes (rolagem de vencimento/meta) e prazos de OS/processo.

**Modelos**
### `/os-models` — GET `?usage=standalone|process` (ativos por uso), GET `/:id`, POST/PATCH/DELETE (ORG_ADMIN). Body: `{ name, description?, departmentId, priority?, visibleToClient?, requiresCompetence, deadlineBusinessDays?: 1..365, autoCompleteOnAllDelivered, usableStandalone, usableInProcess, isActive?, documentRequests: {name}[], documentDeliveries: {name, requiresPayment?, obligationTypeId?}[] }`. 422 `'Marque onde essa OS é usada'`; 422 `'OS com robô precisa pedir competência'`. DELETE de modelo já usado desativa (`{ deactivated: true }`).
### `/process-templates` — além das colunas: `departmentId?` (avalia pedidos), `deadlineBusinessDays?`, `clientCanRequest` (exige departamento: 422 `'Escolha o departamento que avalia os pedidos deste processo'`), `items: { osModelId, columnIndex, dependsOn: number[] }[]` (índices na própria lista; 422 `'Dependência circular entre OS'`, `'Essa OS não é usada em processos'`). Resposta traz `items[{ osModelId, osModel{id,name}, columnPosition, position, dependsOn }]`.

**Abrir**
### POST `/os` `{ osModelId, clientId, competence?: 'AAAA-MM', assigneeId?, dueDate? }` → tarefa da OS (201). 422 `'Informe a competência'`, `'Essa OS é só de processo'`, `'Modelo de OS inativo'`; 404 `'Cliente não encontrado'` fora do escopo.
### POST `/boards` com `processTemplateId` (+ `competence?`) cria o processo e uma OS por item (OS com dependência nasce com `releasedAt = null`). POST `/boards/:id/os` `{ osModelId, columnId, dependsOnTaskIds?, competence?, assigneeId?, dueDate? }` adiciona OS ao processo. Abrir processo revalida os modelos dos itens (422 `'Modelo de OS inativo'`, `'Essa OS não é usada em processos'`), sem deixar board vazio. Os boards `SERVICE_SYSTEM` e `RECURRING_SYSTEM` são únicos por cliente (índices parciais `boards_client_service_system_key` e `boards_client_recurring_system_key`). Streams SSE reconferem a cada minuto se a pessoa continua ativa (e, no processo, o acesso a ele). O cliente recebe `TASK_CREATED` de uma OS que aguarda outra só quando ela é liberada. Na web, "Novo Processo" escolhe o modelo (pede a competência quando alguma OS do modelo é de um período) e o board do processo tem "Adicionar OS" (modelos usados em processos, coluna e OS que ela espera).

**Prazo, pausa, dependência**
- Meta (`targetDate`) = `releasedAt` + `deadlineBusinessDays` + dias úteis pausados. Pausa (`TaskPause`) enquanto houver documento obrigatório do cliente `PENDING`/`REJECTED` ou aprovação do cliente pendente (`UPLOADED` não pausa) — inclusive a OS que já nasce liberada pedindo documento (nasce pausada). Processo: `BoardPause` quando todas as OS liberadas e abertas estão pausadas; meta do processo = abertura + prazo + pausas; `completedAt` quando todas as tarefas terminam.
- OS não liberada: PATCH de status e `/move` → 409 `'Esta OS aguarda: <títulos>'`. Concluir/desconsiderar libera as dependentes (uma vez; sino `OS_RELEASED`). POST `/tasks/:id/release` `{ reason }` (ORG_ADMIN/ORG_MANAGER, dentro do escopo de escrita: fora dele → 404) libera antes (histórico `os_released_early`).
- PATCH `/tasks/:id` com `status` move o cartão junto: `DONE` vai para a primeira coluna `statusEffect = DONE` do board; reabrir uma tarefa que está numa coluna `DONE` leva à coluna do novo status (ou à primeira não-DONE). Grava `moved_to`.
- GET `/tasks?dateField=period&dateFrom&dateTo` inclui também as tarefas abertas com meta (ou vencimento, sem meta) antes de `dateFrom`.
- Listas trazem `deadline: { state: NONE|ON_TIME|DUE_SOON|LATE|PAUSED|WAITING_DEPENDENCY|DONE, businessDaysLeft?, businessDaysLate?, pausedSinceDays?, officeBusinessDays, clientBusinessDays }` (GET `/tasks`, `/boards`, `/boards/:id` — tarefas e processo) e `waitingFor: string[]`.

**Motivo de atraso**
### `/delay-reasons` — GET (cria os padrões na primeira leitura: Aguardando órgão público, Retrabalho interno, Volume de trabalho, Outro com observação), POST/PATCH/DELETE (ORG_ADMIN; usado → desativa).
- PATCH `/tasks/:id` com `status: DONE` e `/tasks/:id/move` para coluna de conclusão aceitam `delayReasonId`, `delayNote`, `processDelayReasonId`, `processDelayNote`. OS atrasada sem motivo → 422 `'Informe o motivo do atraso'`; última OS de processo atrasado → 422 `'Informe o motivo do atraso do processo'`; motivo com observação obrigatória → 422 `'Descreva o motivo'`. Conclusão automática não bloqueia: `delayReasonPending = true`.
- PATCH `/tasks/:id/delay-reason` e `/boards/:id/delay-reason` `{ delayReasonId, delayNote? }` registram antes ou resolvem pendente (escopo de escrita da carteira: fora dela → 404). Histórico `delay_reason_set` / `process_delay_reason_set`. Na web, um processo concluído com atraso sem motivo (fechou sozinho) mostra "Processo concluído com atraso — registrar o motivo" no cabeçalho.

**Listas e indicadores**
### GET `/os?clientId&osModelId&assigneeId&departmentId&boardId&situation&search` — OS (avulsas e de processo) com `deadline`, `process`, `link`; atrasadas primeiro; escopo de Tarefas.
### GET `/boards/:id/stage-times` → `{ columns: {columnId,title,totalBusinessDays,avgBusinessDays}[], os: {taskId,title,officeBusinessDays,clientBusinessDays,state}[] }` (histórico `moved_to` com `fromColumnId`/`toColumnId`; registros antigos sem id casam pelo título).
### GET `/dashboard/os?from=AAAA-MM-DD&to=AAAA-MM-DD` → `{ delaysByReason, pendingReasons, byModel: {kind,id,name,count,avgOfficeBusinessDays,avgClientBusinessDays,lateCount}[] }`.

**Portal e solicitações**
### GET `/portal/services?clientId=` → `{ kind: 'OS'|'PROCESS', id, name, description, departmentId, requiresCompetence }[]` (OS avulsas e processos com `clientCanRequest` dos departamentos do usuário).
- POST `/portal/requests` aceita `osModelId` ou `processTemplateId` (o departamento vem do modelo) e `competence: 'AAAA-MM'`; 422 `'Serviço indisponível'`, `'Informe a competência'`. Aprovação: `{ mode: 'OS', osModelId? }` abre a OS; `NEW_BOARD` com modelo de processo que tem OS abre o processo (`Request.boardId`); `EXISTING_BOARD` aceita `osModelId` e `dependsOnTaskIds`.
- Fila do robô: `suggestion.osModelName` e `suggestion.processTitle`.

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

### GET `/portal/tasks/:taskId/history` _(CLIENT)_ — histórico da tarefa visível ao cliente
→ Só as ações que o cliente pode ver (criação, movimentação, status, documentos, entregas, aprovações, anexos, pausa/liberação da OS). Ficam fora responsável/assumir, prioridade, departamento, motivos de atraso, liberação antecipada, avisos do robô e fechamento de aprovação pelo escritório. Campos: `id, action, fromValue, toValue, actorType, actorName, createdAt` (sem `actorId`).

### GET `/portal/requests` _(CLIENT)_ — `?clientId=` **obrigatório** — 400 se ausente, 404 se o `ClientUser` não tem acesso àquele `clientId`
### POST `/portal/requests` _(CLIENT)_
```json
{
  "clientId": "string", "title": "string", "description": "string?", "departmentId": "string?",
  "processTemplateId": "string?"
}
```
→ `processTemplateId` (opcional) é o tipo de solicitação escolhido pelo cliente (ver o catálogo `GET /portal/services`) — fica salvo na `Request` e é usado por `POST /requests/:id/approve` quando o escritório aprova em modo `NEW_BOARD`
→ `clientId` **obrigatório** no body — 404 se o `ClientUser` não tem acesso àquele `clientId`

### GET `/portal/requests/:id` _(CLIENT)_
### PATCH `/portal/requests/:id/cancel` _(CLIENT)_
### POST `/portal/requests/:id/attachments` _(CLIENT)_ — multipart, max 20MB
→ Aceito com a solicitação em análise (`PENDING` ou `NEEDS_INFO`; outra situação → 422). O acesso é conferido antes de ler o arquivo. Resposta e listas (`GET /requests`, `GET /requests/:id`, `GET /portal/requests`, `GET /portal/requests/:id`) trazem cada anexo como `{ id, filename, mimeType, size, uploadedBy, createdAt, url }` — `url` é link temporário (1h); a chave do storage nunca sai da API.

---

## Templates de Mensagem

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
→ `number` pode vir como a pessoa digita (`(82) 99999-1234`): é normalizado para o formato do MaximizeBot (só dígitos, com 55); número inválido → 400 sem chamar o provedor.

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
### GET `/notifications/stream?ticket=` _(equipe | CLIENT, SSE)_
Ticket de `POST /stream/ticket`. Canal da própria pessoa (`inbox:user:<id>` / `inbox:client:<id>`), evento `inbox:changed` (sem payload) a cada notificação nova e a cada leitura — o front recarrega contador, lista e conversas abertas. MASTER → 403.
### POST `/notifications/read-all` → `{ count }`
### POST `/notifications/read-by-task` `{ taskId }` → `{ count }` — usado ao abrir a conversa da tarefa no portal; marca só as `TASK_COMMENT` daquela tarefa

Retenção: notificações lidas com mais de 180 dias são apagadas pelo cron `inbox-purge` (3h30 BRT). Destinatários da equipe inativos são ignorados.

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
Tarefa fora do escopo → 404; só vê (não pode mexer) → 403 `Assuma a tarefa para alterá-la`; tarefa interna → 422 `Só tarefas visíveis ao cliente podem pedir aprovação`; encerrada → 409; já existe pendente → 409 `Já existe uma aprovação aguardando o cliente nesta tarefa`. Trava a linha da tarefa (mesmo lock do gate de conclusão). Histórico `approval_requested`; aviso `APPROVAL_REQUESTED` (WhatsApp/e-mail, toggle `approvalRequested`) + sino.
### GET `/tasks/:id/approvals` _(equipe)_ → `Approval[]`
### POST `/approvals/:id/close` _(equipe)_ — JSON `{ reason, note }` ou multipart com os mesmos campos antes do `file` (print opcional)
`note` obrigatória nos dois motivos. Exige poder mexer na tarefa (fora do escopo 404; só vê → 403 `Assuma a tarefa para alterá-la`). Grava `decidedByUserId`, `decidedAt`, `waitedDays` (dias inteiros desde o pedido). Histórico `approval_closed_by_office`.
O cliente vê as aprovações dentro de `GET /portal/document-requests` (cada tarefa traz `approvals`).
### POST `/portal/approvals/:id/approve` _(CLIENT)_ `{ note? }` · POST `/portal/approvals/:id/request-changes` _(CLIENT)_ `{ note }` (obrigatória)
Histórico `approval_approved` / `approval_changes_requested`; pedido de ajuste avisa quem pediu e o responsável atual (`APPROVAL_CHANGES_REQUESTED`, toggle `approvalChangesRequested`, link para a tarefa); sino `APPROVAL_DECIDED`. Pedido de ajuste não dispara a conclusão automática. Tarefa encerrada → 409 (`Approval.taskClosed = true` no portal).

Arquivo e comprovante de uma aprovação não podem ser removidos em `DELETE /tasks/:id/attachments/:id` (409). Comprovante enviado num fechamento recusado (409) é descartado.

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
Recebe eventos do Asaas. Token **só** no header `asaas-access-token` (o configurado no painel do Asaas; `?accessToken=` na URL → 401, porque ficaria em log de proxy). Corpo validado com Zod (inválido → 400); evento não tratado → 200 e ignorado. Só age em escritório `billingMode: ASAAS`.

| Evento Asaas            | Ação no Tramita                                 |
|-------------------------|--------------------------------------------------|
| `PAYMENT_CONFIRMED`     | `subscriptionStatus = ACTIVE`, renova período   |
| `PAYMENT_OVERDUE`       | `subscriptionStatus = GRACE_PERIOD` (7 dias); ignorado se o mesmo pagamento já foi confirmado (evento fora de ordem) |
| `PAYMENT_DELETED`       | só registra no histórico (cobrança apagada/renegociada não suspende o escritório) |
| `SUBSCRIPTION_DELETED`  | `subscriptionStatus = CANCELLED` (reentrega não duplica) |

**Idempotência:** histórico e mudança de status na mesma transação, histórico primeiro; o índice único `(asaasPaymentId, event)` faz a reentrega do mesmo evento de um pagamento ser só confirmada (200), sem reaplicar.
**Suspensão:** vem da carência vencida (`checkSubscription` suspende na próxima ação) ou do Master. `SUSPENDED` e `CANCELLED` bloqueiam toda alteração (403); a leitura continua.

---

**Cabeçalhos de segurança:** toda resposta da API leva os do `@fastify/helmet` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, HSTS, `Cross-Origin-Resource-Policy: same-site`).

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
Para o CLIENT os eventos chegam **só com o nome** (`data: {}`): título e ids não saem pelo stream (ele não filtra por departamento nem por `visibleToClient`); o portal recarrega pela API, que filtra.

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