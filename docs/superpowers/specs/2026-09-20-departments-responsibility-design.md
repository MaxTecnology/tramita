# Departamentos + Responsabilidade por Cliente — Design

## Objetivo

Fundação organizacional pro roadmap de evolução do Tramita (Fase 10, ver `docs/TASKS.md`): antes de construir o motor de tarefas recorrentes (item 2b), o escritório precisa poder dizer **quem é responsável por qual cliente, em qual departamento** — ex: "Ana cuida do Fiscal do Cliente X, Bruno cuida do Pessoal do Cliente X". Sem isso, uma obrigação recorrente ("Folha de pagamento") não tem como saber pra quem notificar, e uma lista cross-cliente filtrada por tipo de obrigação (item 2c do roadmap) não tem como agrupar por área de trabalho.

Esta spec cobre só a fundação: Departamentos + responsabilidade por cliente/departamento + roteamento de notificação por departamento nos dois pontos que já existem hoje (comentário de cliente em tarefa, e Solicitação). O motor de recorrência em si (2b), a lista cross-cliente (2c), o calendário (2d) e a sinalização de impedimento no portal (2e) são specs futuras que **consomem** esta fundação, não fazem parte deste documento.

## Contexto — o que já existe

- **`ClientAssignment`** (`apps/api/prisma/schema.prisma:135`) já existe: relação simples Cliente↔Usuário, sem departamento, `@@unique([clientId, userId])`. Hoje serve só pra **roteamento de notificação**: `apps/web/src/pages/app/Clients.tsx` mostra um multi-select de usuários por cliente, com o aviso "Quando definido, só os responsáveis recebem notificações deste cliente. Sem responsável, notifica todos os admins e gerentes."
- É consultado em exatamente dois lugares no backend: `apps/api/src/modules/comments/comments.service.ts` (quando o **cliente** comenta numa tarefa, notifica os responsáveis atribuídos, com fallback pra `ORG_ADMIN`+`ORG_MANAGER`) e `apps/api/src/modules/requests/requests.service.ts` (quando uma nova Solicitação é criada, mesmo padrão de fallback).
- **Decisão do usuário:** os dados atuais de `ClientAssignment` no banco são só de teste — não precisam ser preservados na migração. A migração pode adicionar colunas obrigatórias diretamente, sem lógica de backfill.

## Modelo de dados

### Novo: `Department`

```prisma
model Department {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization      Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  clientAssignments ClientAssignment[]
  tasks              Task[]
  requests           Request[]

  @@unique([organizationId, name])
  @@map("departments")
}
```

Escopado por organização — cada escritório cria os seus (Fiscal, Pessoal, Contábil, Legalização, ou o que fizer sentido pra ele). Sem seed de departamentos padrão — nasce vazio, o escritório cadastra.

### `ClientAssignment` — alterado

```prisma
model ClientAssignment {
  id           String   @id @default(cuid())
  clientId     String
  departmentId String
  userId       String
  createdAt    DateTime @default(now())

  client     Client     @relation(fields: [clientId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([clientId, departmentId])
  @@map("client_assignments")
}
```

Chave única muda de `(clientId, userId)` pra `(clientId, departmentId)` — no máximo um responsável por cliente+departamento (não mais "múltiplos usuários por cliente" genérico). Um mesmo usuário pode aparecer em mais de um departamento do mesmo cliente (ex: escritório pequeno onde a mesma pessoa cuida de Fiscal e Pessoal) — isso é permitido porque `userId` não faz parte da constraint única.

### `Task` — alterado

```prisma
model Task {
  // ...campos existentes...
  departmentId String?
  // ...
  department Department? @relation(fields: [departmentId], references: [id])
}
```

Campo opcional. `null` = comportamento de hoje (notificação de comentário cai no fallback: todos os responsáveis do cliente, independente de departamento — união de todos os `ClientAssignment` desse cliente — ou todos admins/gerentes se não houver nenhum responsável). Preenchido = roteamento específico pro responsável daquele departamento nesse cliente.

### `Request` — alterado

```prisma
model Request {
  // ...campos existentes...
  departmentId String?
  // ...
  department Department? @relation(fields: [departmentId], references: [id])
}
```

Também opcional — o cliente escolhe ao abrir a solicitação no portal; pode deixar em branco ("não sei/geral"), cai no mesmo fallback. Quando a Solicitação é aprovada e vira Tarefa (`approveRequest`, tanto no modo `EXISTING_BOARD` quanto `NEW_BOARD`), o `departmentId` da Request é copiado pra `departmentId` da Task criada — o escritório não precisa marcar de novo.

### Migração

Uma migration só: cria a tabela `departments`, adiciona `departmentId` (obrigatório, com FK) em `client_assignments`, adiciona `departmentId` (opcional, com FK) em `tasks` e `requests`. Como os dados atuais de `client_assignments` são só de teste (decisão do usuário), a migration pode ser destrutiva nessa tabela especificamente — dropar e recriar `client_assignments` é mais simples que uma migration de backfill. **Antes de rodar em qualquer ambiente com dado real, confirmar com o usuário** (regra geral do projeto pra operação destrutiva) — mas hoje só existe banco de teste/dev.

## Mudanças de API

### Novo módulo `departments`

Estrutura padrão do projeto (`apps/api/src/modules/departments/`):
- `departments.routes.ts` — `GET /departments`, `POST /departments`, `PATCH /departments/:id`, `DELETE /departments/:id`, todas com `preHandler: [verifyJWT, verifyOrg, requireRole(['ORG_ADMIN'])]` (mesmo padrão de `plans.routes.ts`/rotas de Configurações).
- `departments.service.ts` — CRUD simples escopado por `organizationId`. `DELETE` é soft ou hard delete? Dado que departamentos podem ter `ClientAssignment`/`Task`/`Request` vinculados, e a política do projeto é soft-delete quando aplicável — mas `Department` não tem um caso de uso claro pra "departamento inativo mas histórico visível" (diferente de Cliente/Usuário). Decisão: hard delete é bloqueado se houver qualquer `ClientAssignment` vinculado (erro 409, "Departamento em uso — remova as atribuições antes"); tarefas/solicitações já fechadas com esse departamento mantêm o `departmentId` histórico (não é FK `onDelete: Cascade` pra essas duas, só pra `ClientAssignment`).
- `departments.schema.ts` — `{ name: z.string().min(1) }`.

### `clients.service.ts` — assignments viram por-departamento

`GET /clients/:id/assignments` passa a retornar `{ departmentId, department: { name }, userId, user }[]` (uma linha por departamento que tem responsável definido — departamentos sem responsável simplesmente não aparecem na lista).

`PUT /clients/:id/assignments` muda de payload: hoje é `{ userIds: string[] }` (substitui a lista toda). Novo payload: `{ departmentId: string, userId: string | null }` (substitui/remove o responsável de **um** departamento por vez — `userId: null` remove a atribuição daquele departamento). Isso é uma mudança de contrato da rota existente — o frontend (`AssignmentsSection` em `Clients.tsx`) muda de "salvar lista inteira" pra "salvar uma linha por vez", uma chamada por departamento alterado.

### Notificação — `comments.service.ts` e `requests.service.ts`

Em ambos, a query que hoje é:
```typescript
const assignments = await prisma.clientAssignment.findMany({
  where: { clientId },
  select: { userId: true },
})
```
passa a considerar o departamento da entidade que disparou o evento (`task.departmentId` em `comments.service.ts`, `request.departmentId` — já disponível na Request recém-criada — em `requests.service.ts`):
```typescript
const assignments = await prisma.clientAssignment.findMany({
  where: departmentId
    ? { clientId, departmentId }
    : { clientId },
  select: { userId: true },
})
```
Quando `departmentId` é `null` (tarefa/solicitação sem departamento marcado), o comportamento é idêntico ao de hoje — todos os responsáveis do cliente, independente de departamento. Quando `departmentId` existe, só o responsável daquele departamento (se houver) entra na lista; se não houver responsável definido pra aquele departamento específico, cai no fallback de `ORG_ADMIN`+`ORG_MANAGER` (mesma regra do fallback geral, só que agora também dispara quando "esse departamento não tem responsável", não só quando "esse cliente não tem responsável nenhum").

## Frontend

- **Nova página "Departamentos"** em `apps/web/src/pages/app/settings/Departments.tsx`, roteada em `/app/settings/departments`, item de menu novo em `AppLayout.tsx` sob "Configurações" (mesmo grupo de Templates/Notificações/Assinatura, mesmo gate `ADMIN_ROLES`). CRUD simples: lista + criar + renomear + apagar (com o bloqueio 409 tratado no frontend como toast de erro).
- **`Clients.tsx` → `AssignmentsSection`**: troca o multi-select atual por uma lista com uma linha por departamento da organização (busca `GET /departments`), cada linha com um `<select>` de usuário (incluindo opção "Sem responsável"). Salvar dispara `PUT /clients/:id/assignments` só pra a linha que mudou.
- **Criação/edição de tarefa** (`TaskDrawer` e o modal de criação rápida, se houver): campo opcional "Departamento" (select, pode ficar vazio).
- **Portal do cliente — abrir Solicitação**: campo opcional "Departamento" no formulário de nova solicitação (select com os departamentos da organização do escritório, pode ficar vazio = "não sei").

## Testes

- `departments.service.ts`: CRUD, isolamento por organização, bloqueio de delete com `ClientAssignment` vinculado.
- `clients.service.ts` (assignments): upsert de responsável por cliente+departamento substitui o anterior (não soma); mesmo usuário pode ser responsável em departamentos diferentes do mesmo cliente; `userId: null` remove a atribuição.
- `comments.service.ts` / `requests.service.ts`: teste de que uma tarefa/solicitação **com** departamento notifica só o responsável daquele departamento (ou fallback admin/gerente se esse departamento específico não tiver responsável); teste de que uma tarefa/solicitação **sem** departamento mantém o comportamento atual (todos os responsáveis do cliente, fallback geral).
- `requests.service.ts` (approve): teste de que aprovar uma Request com `departmentId` propaga esse valor pra `departmentId` da Task criada, nos dois modos (`EXISTING_BOARD`/`NEW_BOARD`).
- Sem teste novo pra CRUD de rotas simples nem pro frontend, seguindo a política do projeto.

## Riscos e limitações conhecidas

- Migration é destrutiva na tabela `client_assignments` (aceito pelo usuário — dado atual é só de teste). Se este código já estiver em produção com dado real quando isso for implementado, a migration precisa ser revisada pra uma versão com backfill (criar departamento "Geral" por organização e migrar os dados existentes pra ele) — não é o caso hoje.
- Departamento em Tarefa/Request é opcional por design — nada força o escritório a usá-lo. Tarefas recorrentes (fase 2b) sempre virão com departamento (herdado do template de recorrência), mas tarefas manuais continuam podendo ficar sem, o que é intencional (nem todo processo do escritório precisa de categorização por área).
- Excluir um departamento com `ClientAssignment` vinculado é bloqueado (409) — não há fluxo de "mesclar departamentos" ou reatribuição em massa nesta fase; se o escritório errar o nome de um departamento, a correção é editar o nome (`PATCH`), não apagar e recriar.
