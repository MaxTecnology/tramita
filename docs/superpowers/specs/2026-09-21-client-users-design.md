# Usuários de Cliente com Acesso por Departamento — Design

## Contexto

Hoje o login do portal do cliente é o próprio registro `Client` (a empresa):
`Client.email` + `Client.passwordHash` é literalmente a conta que loga, e
`request.user.sub` (o `id` do JWT) é usado em todo o código do portal como
sinônimo de `clientId`. Uma empresa-cliente só pode ter uma pessoa logando,
e essa pessoa vê tudo — não existe conceito de "departamento" no portal.

Isso não reflete a realidade do escritório contábil: uma empresa-cliente
tem vários funcionários (RH, financeiro, diretoria) e cada um só deveria
ver as tarefas do departamento que lhe interessa (ex: alguém do RH só vê
tarefas do departamento "Pessoal").

Modelo de referência: tela de "Usuário de cliente" do Gestta — cadastro
único de pessoa (nome/e-mail/senha/telefone), com uma lista de vínculos
"Cliente + Departamento" (repetível — o mesmo usuário pode ter várias
linhas, cobrindo várias empresas e vários departamentos por empresa).

## Objetivo

1. Desacoplar "empresa-cliente" (`Client`) de "quem loga" — introduzir
   `ClientUser` como a entidade de login do portal.
2. Um `ClientUser` pode acessar várias empresas-cliente (útil pra grupos
   econômicos ou contadores terceirizados que atendem mais de uma empresa
   do mesmo escritório), e para cada empresa, um subconjunto específico de
   departamentos.
3. Dentro do portal, tarefas só aparecem pro `ClientUser` se o departamento
   da tarefa estiver entre os departamentos liberados pra aquela empresa.
4. Tornar `Task.departmentId` obrigatório — toda tarefa nasce com
   departamento definido, pra que o filtro de visibilidade nunca dependa de
   um valor ausente.
5. Tela dedicada de gestão de `ClientUser` (fora do cadastro de cliente) +
   uma seção no cadastro de cliente pra vincular usuários existentes ou
   criar novos, com pelo menos 1 usuário obrigatório antes de salvar.

## Fora de escopo (registrado pra spec futura)

- Aba "Permissões" do Gestta (feature flags granulares por usuário).
- Outras abas do cadastro de cliente vistas no Gestta: Senhas, CNAEs,
  Certidões e certificados, Geração de tarefas.
- Mudar o comportamento de `Request` (solicitação do cliente) — continua
  com `departmentId` opcional, sem filtro por `ClientUserAccess`.

## Modelo de Dados

```prisma
model ClientUser {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  email          String
  passwordHash   String
  phone          String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  accesses     ClientUserAccess[]

  @@unique([email, organizationId])
  @@map("client_users")
}

model ClientUserAccess {
  id           String @id @default(cuid())
  clientUserId String
  clientId     String
  departmentId String

  clientUser ClientUser @relation(fields: [clientUserId], references: [id], onDelete: Cascade)
  client     Client     @relation(fields: [clientId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)

  @@unique([clientUserId, clientId, departmentId])
  @@map("client_user_accesses")
}
```

`Client` perde `email` e `passwordHash` (colunas removidas — não servem
mais pra login, e não há dado real cadastrado ainda pra migrar). O nome da
empresa, CNPJ, endereço etc continuam no `Client` normalmente.

`Task.departmentId` vira `String` (obrigatório, era `String?`). A relação
`department Department? @relation(...)` vira `department Department
@relation(...)`. Sem backfill necessário (confirmado: não há tarefa de
teste sem departamento hoje).

### Migration (2 arquivos, escritos à mão)

**1. `client_users` + `client_user_accesses`:** `CREATE TABLE` das duas
tabelas novas, mais `ALTER TABLE clients DROP COLUMN email, DROP COLUMN
"passwordHash"`. Como `clients_email_organizationId_key` é um índice único
sobre a coluna que está sendo removida, o `DROP COLUMN email` já remove o
índice junto (comportamento padrão do Postgres).

**2. `task_department_required`:** `ALTER TABLE tasks ALTER COLUMN
"departmentId" SET NOT NULL`. Falha alto e claro se existir alguma tarefa
com `departmentId` nulo no ambiente de destino — comportamento aceitável
aqui (o usuário confirmou que não há nenhuma), mas listado como risco
conhecido no plano de implementação.

## Autenticação

`login(email, password)` em `auth.service.ts` passa a tentar, em ordem:

1. `User` (staff do escritório/master) — inalterado.
2. `ClientUser` (portal) — novo, substitui o fallback anterior pra
   `Client`.

```ts
const clientUser = await prisma.clientUser.findFirst({
  where: { email, isActive: true },
  include: { organization: { select: { name: true } } },
})
if (clientUser && (await verifyPassword(password, clientUser.passwordHash))) {
  return buildSession(clientUser.id, clientUser.name, 'CLIENT', clientUser.organizationId, clientUser.organization?.name ?? null)
}
```

`ClientUser` inativo (`isActive: false`) não loga — mesma mensagem genérica
`401 Credenciais inválidas` (não revela se o e-mail existe, igual ao
comportamento atual pra `User`).

O JWT continua com o mesmo formato (`sub`, `role: 'CLIENT'`,
`organizationId`) — só que agora `sub` é `clientUser.id`, não mais
`client.id`. **Não** guardamos a lista de empresas/departamentos no token
(token ficaria grande e desatualizado se o admin mudar o acesso no meio da
sessão) — cada rota do portal resolve o acesso em tempo real via
`ClientUserAccess`.

## Resolução de acesso (helper central)

Novo módulo `apps/api/src/modules/client-users/client-access.ts`:

```ts
export interface ClientAccessScope {
  clientIds: string[]
  departmentIdsByClient: Map<string, Set<string>>
}

export async function getClientAccessScope(clientUserId: string): Promise<ClientAccessScope> {
  const accesses = await prisma.clientUserAccess.findMany({
    where: { clientUserId },
    select: { clientId: true, departmentId: true },
  })
  const departmentIdsByClient = new Map<string, Set<string>>()
  for (const a of accesses) {
    if (!departmentIdsByClient.has(a.clientId)) departmentIdsByClient.set(a.clientId, new Set())
    departmentIdsByClient.get(a.clientId)!.add(a.departmentId)
  }
  return { clientIds: [...departmentIdsByClient.keys()], departmentIdsByClient }
}

export function canSeeTask(scope: ClientAccessScope, clientId: string, departmentId: string): boolean {
  return scope.departmentIdsByClient.get(clientId)?.has(departmentId) ?? false
}
```

Usado por toda rota do portal que hoje usa `request.user.sub` como
`clientId` direto.

## Mudanças nas rotas do portal

| Rota | Antes | Depois |
|---|---|---|
| `GET /portal/board` (lista boards) | `where: { clientId: sub }` | `where: { clientId: { in: scope.clientIds } }` |
| `GET /portal/board/:boardId` | `getBoardById(id, org, true, sub)` — 4º parâmetro é um `clientId: string` único | `getBoardById` ganha uma 4ª assinatura que aceita `string[]` (a implementação já usa esse parâmetro só pra montar `where: { clientId }`, então vira `where: { clientId: hasMany ? { in } : clientId }`); tarefas filtradas também por `departmentId ∈ scope.departmentIdsByClient.get(board.clientId)` (além do `visibleToClient` já existente) |
| `GET /portal/tasks/:taskId/history` | `getTaskHistory(taskId, org, sub)` | mesmo, mas a query que valida a tarefa agora inclui o filtro de departamento (reaproveita `canSeeTask`) |
| `GET /portal/tasks/:taskId/documents` | `verifyTaskAccess(taskId, org, sub)` | idem — `verifyTaskAccess` recebe o `scope` e valida `clientId` + departamento em vez de comparar `board.clientId === clientId` |
| `POST /portal/tasks/:taskId/documents/requests/:reqId/upload` | idem | idem |
| Comentários/anexos no portal (via `comments.service`/`attachments.service`, chamados a partir de rotas fora de `portal.routes.ts` mas que aceitam `clientId`) | comparam `task.visibleToClient` | passam a também checar `canSeeTask(scope, board.clientId, task.departmentId)` |
| `GET /portal/profile` | `getClientProfile(sub)` busca em `Client` | busca em `ClientUser` (`id, name, email, phone`) |
| `PATCH /portal/profile` | atualiza `Client.whatsapp`/senha | atualiza `ClientUser.phone`/senha — **`whatsapp` sai do perfil do portal** (era campo do `Client`/empresa, não da pessoa; endereço/WhatsApp da empresa continuam editáveis só pelo escritório) |
| `GET /portal/requests`, `POST /portal/requests`, etc | usam `sub` como `clientId` direto | **mudam de forma**: precisam de um `clientId` explícito no path/query, já que um `ClientUser` pode ter mais de uma empresa — ver seção abaixo |

### Solicitações (`Request`) com múltiplas empresas

Como um `ClientUser` agora pode enxergar mais de uma empresa, as rotas de
`Request` do portal (`/portal/requests`) precisam saber **qual** empresa
está em jogo. Duas rotas mudam de assinatura:

- `POST /portal/requests` → corpo ganha `clientId` obrigatório (validado
  contra `scope.clientIds`, 403 se a empresa não pertence ao usuário).
- `GET /portal/requests` → query `?clientId=` obrigatória (mesmo motivo).

O frontend do portal precisa de um seletor de empresa quando
`scope.clientIds.length > 1` (ver seção Frontend). Quando só há uma
empresa, o seletor fica oculto e a empresa é pré-selecionada
automaticamente — zero fricção pro caso comum (uma pessoa, uma empresa).

## Backend — módulo `client-users`

Novo módulo `apps/api/src/modules/client-users/`, seguindo o padrão do
projeto (`.routes.ts` / `.service.ts` / `.schema.ts` / `.types.ts`).

### Schemas (Zod)

```ts
export const createClientUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  isActive: z.boolean().default(true),
  accesses: z.array(z.object({
    clientId: z.string().cuid(),
    departmentId: z.string().cuid(),
  })).min(1, 'Selecione pelo menos um cliente e departamento'),
})

export const updateClientUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(), // omitido = não troca a senha
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  accesses: z.array(z.object({
    clientId: z.string().cuid(),
    departmentId: z.string().cuid(),
  })).min(1, 'Selecione pelo menos um cliente e departamento').optional(),
})
```

`accesses` no update, quando enviado, **substitui** a lista inteira (mais
simples que diffs incrementais — o service faz `deleteMany` + `createMany`
dentro de uma transação).

### Endpoints

```
GET    /client-users                 (ORG_ADMIN | ORG_MANAGER) — lista, com accesses (cliente+depto) populados
GET    /client-users/:id             (ORG_ADMIN | ORG_MANAGER)
POST   /client-users                 (ORG_ADMIN | ORG_MANAGER) — checkSubscription
PATCH  /client-users/:id             (ORG_ADMIN | ORG_MANAGER) — checkSubscription
DELETE /client-users/:id             (ORG_ADMIN | ORG_MANAGER) — checkSubscription — soft delete (isActive=false, não some da lista)
```

`createClientUser` valida que todo `clientId`/`departmentId` em `accesses`
pertence à mesma `organizationId` do usuário logado (evita vazamento
cross-tenant), igual ao padrão já usado em `recurring-templates.service.ts`
pra `departmentId`.

E-mail único por organização (`@@unique([email, organizationId])`) — erro
`409` se duplicado, mesma convenção de `clients.service.ts`.

### Client — endpoint auxiliar de busca

`GET /clients/search-users?q=` (ORG_ADMIN | ORG_MANAGER) — autocomplete
usado no cadastro de cliente pra "vincular usuário já cadastrado" (busca
por nome/e-mail entre os `ClientUser` da org, com `isActive: true`).

## Frontend

### Tela nova: `/app/client-users` (ORG_ADMIN | ORG_MANAGER)

Segue o padrão de `Users.tsx`/`RecurringTemplates.tsx`: lista + formulário
em página dedicada (não modal — mesma lição do fix anterior nesta sessão
sobre formulários longos perderem dados em modal). Rotas:

- `/app/settings/client-users` (lista)
- `/app/settings/client-users/new`
- `/app/settings/client-users/:id/edit`

Formulário: Nome, E-mail, Senha (placeholder "Deixe em branco pra manter"
no edit), Telefone, Ativo (toggle) — e um repetidor "Cliente + Departamento
+ botão adicionar", com lista das linhas já adicionadas (cada uma com
botão remover), igual ao Gestta.

Entrada no menu lateral de Configurações, ao lado de "Departamentos" e
"Tarefas Recorrentes".

### Cadastro de Cliente (`Clients.tsx`)

Nova seção "Usuários com acesso" no formulário (create e edit), depois de
Endereço:

- Autocomplete pra buscar um `ClientUser` já existente da org
  (`GET /clients/search-users`) — ao selecionar, escolhe o(s)
  departamento(s) pra aquele vínculo e adiciona à lista local.
- Botão "Criar novo usuário" — abre um mini-form inline (nome/e-mail/senha)
  sem sair da tela; ao salvar, vira uma entrada na lista local igual à
  busca (a criação real do `ClientUser` + dos `ClientUserAccess`
  acontece junto com o submit do cliente, numa transação).
- Lista de usuários já adicionados (nome + departamentos), com remover.
- **Submit desabilitado se a lista estiver vazia** — mensagem "Adicione
  pelo menos um usuário" perto do botão.

Isso muda `POST /clients` e `PATCH /clients/:id`: corpo ganha
`clientUsers: { existingId?: string, name?: string, email?: string,
password?: string, departmentIds: string[] }[]`, e o `clients.service.ts`
faz, numa transação: cria/atualiza o `Client`, e para cada entrada cria o
`ClientUser` (se novo) + os `ClientUserAccess` correspondentes.

### Formulário de tarefa (`TaskDrawer.tsx` e qualquer outro ponto de criação)

Remove a opção "Sem departamento" do `<select>` de departamento — campo
vira obrigatório (`required`, sem opção vazia). `createTaskSchema` já
aceita tornar `departmentId` obrigatório (remove `.optional()`).

### Portal — seletor de empresa (quando `ClientUser` tem mais de uma)

`PortalLayout` passa a buscar as empresas acessíveis
(`GET /portal/clients` — novo endpoint simples que devolve
`scope.clientIds` resolvidos em `{ id, name }[]`) uma vez no topo. Se
`length > 1`, mostra um seletor (dropdown no header do portal, papel
parecido com um "trocar de empresa"); a empresa selecionada fica em
contexto (`localStorage` + query param) e é usada nas chamadas de
`/portal/requests`. Se `length === 1`, nenhuma UI extra — a única empresa é
usada direto, sem o usuário perceber que o conceito existe.

## Testes (obrigatórios — lógica crítica)

- `client-access.ts`: `getClientAccessScope` monta o mapa certo a partir
  de várias linhas de `ClientUserAccess`; `canSeeTask` retorna `false` pra
  empresa/departamento fora do escopo.
- `client-users.service.ts`: criação valida `accesses` não vazio, rejeita
  `clientId`/`departmentId` de outra organização, e-mail duplicado dá 409,
  update substitui a lista de accesses corretamente (transação).
- `auth.service.ts`: login por `ClientUser` funciona, `ClientUser` inativo
  não loga, e-mail duplicado entre `User` e `ClientUser` não gera ambiguidade
  (a ordem de tentativa é determinística: `User` primeiro).
- Filtro de portal: tarefa com departamento fora do escopo do `ClientUser`
  não aparece em `GET /portal/board/:id` nem é acessível via
  `GET /portal/tasks/:taskId/*` (404, não 403 — mesma convenção de
  "não revela que existe" já usada pra `visibleToClient`).
- Regressão: `Task` sem `departmentId` é rejeitada na criação (Zod) — não
  precisa de teste de migration em si (é feita à mão, sem lógica de app).

## Riscos conhecidos

- **Migration de `tasks.departmentId` pra NOT NULL falha se existir
  qualquer tarefa órfã** no ambiente de destino (dev, e principalmente o
  Dokploy de produção/homolog) — usuário confirmou que não há hoje, mas o
  plano de implementação deve checar isso explicitamente antes de aplicar
  em qualquer ambiente compartilhado (`SELECT count(*) FROM tasks WHERE
  "departmentId" IS NULL`).
- **Remoção de `Client.email`/`passwordHash`** é destrutiva pra qualquer
  linha existente que já tenha login configurado — igualmente confirmado
  como inofensivo (nenhum dado real).
