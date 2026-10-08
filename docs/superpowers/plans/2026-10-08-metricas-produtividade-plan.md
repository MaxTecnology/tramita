# Métricas de Produtividade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar visibilidade de produtividade por pessoa e departamento (volume, prazo, tempo de
conclusão, carga atual, impedimento), cruzando OS e Recorrente, dentro do Dashboard existente.

**Architecture:** `Task.completedAt` + histórico de `status_changed` confiável (3 pontos de
escrita unificados) como base de dados factual; cálculo de métricas via queries Prisma agrupadas
em memória (sem loop por task, sem tabela de agregação); endpoint único de leitura com controle de
acesso embutido (`ORG_MEMBER` nunca vê produtividade de outra pessoa); frontend em abas dentro do
`DashboardMetrics.tsx` já existente.

**Tech Stack:** Node 22 + TypeScript strict + Fastify v5 + Prisma v6 (backend); React 19 + Vite +
TailwindCSS v4 + React Query (frontend).

**Spec:** `docs/superpowers/specs/2026-10-08-metricas-produtividade-design.md`

**Desvio da spec (refinamento, não contradição):** a spec propunha um módulo novo
`src/modules/metrics/`. Na leitura do código existente, já há um módulo `dashboard` registrado em
`/dashboard` com a própria tela-alvo (`DashboardMetrics.tsx`) consumindo `/dashboard/metrics` —
este plano estende esse módulo existente (`dashboard.service.ts`/`.routes.ts`/`.schema.ts`) em vez
de criar um módulo irmão, por consistência com a estrutura já presente. Também achei um terceiro
ponto de escrita de `Task.status` que a spec não cobriu (`recalculateTaskStatus`, em
`task-documents.service.ts`, disparado pelo recálculo automático de checklist de documentos) — ele
já grava `status_changed` corretamente, mas nunca seta `completedAt`; entra no escopo da Task 3.

## Global Constraints

- TypeScript `strict: true` — sem `any`.
- Validação Zod em toda entrada de borda.
- Erros via `AppError(statusCode, message)`.
- Migrations só via `pnpm --filter api migrate:dev -- --name <nome>` — mas este ambiente não tem
  TTY, então usar o fluxo já validado na feature de SLA: `prisma migrate diff --from-url
  $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script` (stdout/stderr separados) +
  edição manual se necessário + `pnpm --filter api migrate:deploy`. **A migration precisa ser
  aplicada nos dois bancos** — dev (`DATABASE_URL`) e teste (`DATABASE_URL_TEST`, porta 5433) —
  rodando `migrate:deploy` duas vezes, uma com cada `DATABASE_URL`.
- `ORG_MEMBER` nunca pode receber dado de produtividade de outro usuário — a trava é sempre no
  backend (query forçada), nunca só a UI escondendo um seletor.
- Nenhuma métrica em loop de queries por task — sempre 1 query agrupada + redução em memória.

## Review Focus

- Organização/departamento sem nenhuma tarefa concluída no período: todas as médias/percentuais
  devem vir `0`/`applicable: 0`, nunca `NaN` ou erro de divisão por zero.
- Tarefa com `targetDate` nulo (toda tarefa de board OS, hoje): não pode contar como "fora da
  meta" — só entra no denominador de `onTimeRate.target` quem tinha `targetDate` setado.
- Tarefa ainda `BLOCKED` no momento da consulta (sem evento de saída no histórico): o período
  bloqueado conta até `now`, não fica de fora do cálculo nem quebra a query.
- `ORG_MEMBER` filtrando por um `departmentId` que tem outros membros: a quebra "por pessoa" da
  resposta contém só a própria linha, nunca a de um colega do mesmo departamento.
- Tarefa concluída no mesmo instante em que foi criada (sem nenhum evento de histórico
  intermediário): "fechamento tardio" não pode acusar falso positivo por falta de evento anterior
  pra comparar — gap deve ser tratado como `0` nesse caso, não como erro.

---

## Task 1: Schema — `Task.completedAt` + `NotificationConfig.lateClosureThresholdDays`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: `Task.completedAt DateTime?`; `NotificationConfig.lateClosureThresholdDays Int
  @default(2)`.

- [ ] **Step 1: Editar `Task`**

Em `apps/api/prisma/schema.prisma`, no model `Task`, adicionar logo após `targetDate`:

```prisma
  completedAt         DateTime?
```

- [ ] **Step 2: Editar `NotificationConfig`**

Adicionar junto aos outros campos de SLA (depois de `slaDigestEnabled`):

```prisma
  lateClosureThresholdDays Int @default(2)
```

- [ ] **Step 3: Gerar e aplicar a migration (fluxo sem TTY)**

```bash
cd apps/api
set -a && source ../../.env && set +a
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p "prisma/migrations/${TS}_add_productivity_metrics_fields"
node -r dotenv/config ./node_modules/prisma/build/index.js migrate diff \
  --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script \
  1> "prisma/migrations/${TS}_add_productivity_metrics_fields/migration.sql" \
  2>/tmp/migrate-diff-stderr.log
cat "prisma/migrations/${TS}_add_productivity_metrics_fields/migration.sql"  # conferir: só ADD COLUMN, sem DROP/ALTER destrutivo
cd ../..
pnpm --filter api migrate:deploy
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter api migrate:deploy  # banco de teste também
pnpm --filter api exec prisma generate
```

Esperado: migration contém só 2 `ALTER TABLE ... ADD COLUMN` (um em `tasks`, um em
`notification_configs`), nenhum destrutivo — não precisa de edição manual como na migration de SLA
(não há remoção de enum/coluna aqui).

- [ ] **Step 4: Verificar e commitar**

```bash
pnpm --filter api exec tsc --noEmit  # esperado: limpo, nada ainda consome os campos novos
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(metrics): adiciona Task.completedAt e NotificationConfig.lateClosureThresholdDays"
```

---

## Task 2: `src/lib/task-completion.ts` — função pura de transição de status

**Files:**
- Create: `apps/api/src/lib/task-completion.ts`
- Test: `apps/api/src/lib/task-completion.test.ts`

**Interfaces:**
- Produces: `resolveCompletedAt(previousStatus: string, nextStatus: string, now: Date): Date |
  null | undefined` — `Date` quando a tarefa acabou de ficar `DONE`, `null` quando saiu de `DONE`
  pra qualquer outro status (reaberta), `undefined` quando não houve mudança relevante (não toca o
  campo no Prisma — `undefined` é "não altere", diferente de `null` que é "limpe").

- [ ] **Step 1: Escrever os testes**

```typescript
// apps/api/src/lib/task-completion.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCompletedAt } from './task-completion'

describe('resolveCompletedAt', () => {
  it('retorna a data atual quando a tarefa acabou de ficar DONE', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('OPEN', 'DONE', now)).toEqual(now)
  })

  it('retorna null quando a tarefa sai de DONE pra qualquer outro status (reaberta)', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('DONE', 'OPEN', now)).toBeNull()
    expect(resolveCompletedAt('DONE', 'STARTED', now)).toBeNull()
  })

  it('retorna undefined quando não há mudança de status relevante pra completedAt', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('OPEN', 'STARTED', now)).toBeUndefined()
    expect(resolveCompletedAt('OPEN', 'BLOCKED', now)).toBeUndefined()
    expect(resolveCompletedAt('BLOCKED', 'OPEN', now)).toBeUndefined()
  })

  it('retorna undefined quando o status não mudou de fato', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('DONE', 'DONE', now)).toBeUndefined()
    expect(resolveCompletedAt('OPEN', 'OPEN', now)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/lib/task-completion.test.ts
```

- [ ] **Step 3: Implementar**

```typescript
// apps/api/src/lib/task-completion.ts

// undefined = "não mude o campo" (Prisma ignora update com undefined); null = "limpe o campo"
// (tarefa reaberta); Date = "acabou de concluir agora".
export function resolveCompletedAt(
  previousStatus: string,
  nextStatus: string,
  now: Date,
): Date | null | undefined {
  if (previousStatus === nextStatus) return undefined
  if (nextStatus === 'DONE') return now
  if (previousStatus === 'DONE') return null
  return undefined
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/lib/task-completion.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/task-completion.ts apps/api/src/lib/task-completion.test.ts
git commit -m "feat(metrics): adiciona resolveCompletedAt (função pura de transição de status)"
```

---

## Task 3: Fiar `completedAt` + unificar histórico `status_changed` nos 3 pontos de escrita

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.service.ts` (`updateTask`, `moveTask`)
- Modify: `apps/api/src/modules/task-documents/task-documents.service.ts`
  (`recalculateTaskStatus`)
- Modify: `apps/api/src/modules/tasks/tasks.service.test.ts`
- Modify: `apps/api/src/modules/task-documents/task-documents.service.test.ts` (ou arquivo de
  teste equivalente — confirmar nome exato antes de editar)

**Interfaces:**
- Consumes: `resolveCompletedAt` (Task 2).

- [ ] **Step 1: Teste — `updateTask` seta `completedAt`**

Adicionar em `tasks.service.test.ts` (seguir o padrão já existente no arquivo, com
`createTestPlan`/`createTestOrg`/etc):

```typescript
describe('updateTask — completedAt', () => {
  it('seta completedAt ao mudar status pra DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)

    const before = Date.now()
    const updated = await updateTask(task.id, org.id, { status: 'DONE' }, { id: user.id, type: 'user' })

    expect(updated.completedAt).not.toBeNull()
    expect(updated.completedAt!.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('limpa completedAt ao reabrir uma tarefa concluída', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await updateTask(task.id, org.id, { status: 'DONE' }, { id: user.id, type: 'user' })

    const reopened = await updateTask(task.id, org.id, { status: 'OPEN' }, { id: user.id, type: 'user' })

    expect(reopened.completedAt).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/modules/tasks/tasks.service.test.ts -t "completedAt"
```

Esperado: falha porque `updateTask` ainda não seta o campo (ou `updated.completedAt` é
`undefined`/erro de tipo).

- [ ] **Step 3: Implementar em `updateTask`**

Em `tasks.service.ts`, importar `resolveCompletedAt` e usar dentro do `tx.task.update` existente —
adicionar ao objeto `data:` (mesmo bloco que já seta `title`, `status`, etc):

```typescript
import { resolveCompletedAt } from '@/lib/task-completion'

// ...dentro de updateTask, antes do prisma.$transaction:
const completedAt = data.status !== undefined
  ? resolveCompletedAt(task.status, data.status, new Date())
  : undefined

// ...dentro do tx.task.update's `data:`, adicionar:
        completedAt,
```

- [ ] **Step 4: Implementar em `moveTask`**

Em `moveTask`, computar `completedAt` a partir de `task.status`/`nextStatus` (já calculados ali) e
adicionar ao `tx.task.update`:

```typescript
const completedAt = resolveCompletedAt(task.status, nextStatus, new Date())

const updatedTask = await prisma.$transaction(async (tx) => {
  const updated = await tx.task.update({
    where: { id: taskId },
    data: { columnId: data.columnId, position: data.position, status: nextStatus, completedAt },
  })

  await tx.taskHistory.create({
    data: {
      taskId,
      action: 'moved_to',
      fromValue: fromColumn.title,
      toValue: toColumn.title,
      actorType: actor.type,
      actorId: actor.id,
      actorName,
    },
  })

  // Correção: moveTask mudava status via Column.statusEffect sem nunca gravar status_changed,
  // só moved_to — reconstruir "quando ficou DONE/BLOCKED" a partir disso exigiria saber o
  // statusEffect da coluna NO MOMENTO (pode ter sido reconfigurado depois). Unifica com
  // updateTask: toda mudança de status real grava status_changed, independente do caminho.
  if (nextStatus !== task.status) {
    await tx.taskHistory.create({
      data: {
        taskId,
        action: 'status_changed',
        fromValue: task.status,
        toValue: nextStatus,
        actorType: actor.type,
        actorId: actor.id,
        actorName,
      },
    })
  }

  return updated
})
```

- [ ] **Step 5: Teste — `moveTask` grava `status_changed` e seta `completedAt`**

```typescript
describe('moveTask — completedAt e status_changed', () => {
  it('seta completedAt e grava status_changed ao mover pra coluna com statusEffect DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const openColumn = await createTestColumn(board.id, { position: 0 })
    const doneColumn = await createTestColumn(board.id, { position: 1, statusEffect: 'DONE' })
    const task = await createTestTask(openColumn.id, user.id)

    const moved = await moveTask(task.id, org.id, { columnId: doneColumn.id, position: 0 }, { id: user.id, type: 'user' })

    expect(moved.completedAt).not.toBeNull()
    expect(moved.status).toBe('DONE')

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(1)
    expect(history[0].toValue).toBe('DONE')
  })

  it('não grava status_changed quando a coluna de destino não tem statusEffect (fase organizacional)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const colA = await createTestColumn(board.id, { position: 0 })
    const colB = await createTestColumn(board.id, { position: 1, statusEffect: 'NONE' })
    const task = await createTestTask(colA.id, user.id)

    await moveTask(task.id, org.id, { columnId: colB.id, position: 0 }, { id: user.id, type: 'user' })

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(0)
  })
})
```

- [ ] **Step 6: Implementar em `recalculateTaskStatus`**

Em `task-documents.service.ts`, importar `resolveCompletedAt` e adicionar `completedAt` ao
`prisma.task.update` dentro da transação:

```typescript
import { resolveCompletedAt } from '@/lib/task-completion'

// ...dentro de recalculateTaskStatus, no bloco `if (nextStatus && nextStatus !== task.status)`:
  if (nextStatus && nextStatus !== task.status) {
    const completedAt = resolveCompletedAt(task.status, nextStatus, new Date())
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: nextStatus, completedAt } }),
      prisma.taskHistory.create({
        data: {
          taskId,
          action: 'status_changed',
          fromValue: task.status,
          toValue: nextStatus,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (checklist)',
        },
      }),
    ])
```

- [ ] **Step 7: Teste — `recalculateTaskStatus` seta `completedAt` na conclusão automática**

Em `apps/api/src/modules/task-documents/task-documents.service.test.ts` já existe o teste
`'conclusão automática só dispara com autoCompleteOnAllActivitiesDone=true no template de
origem'` (dentro do describe que cobre esse fluxo) — adicionar a asserção de `completedAt` nele
mesmo, imediatamente após a asserção existente de `updated.status`:

```typescript
    const updated = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(updated.status).toBe('DONE')
    expect(updated.completedAt).not.toBeNull() // <- linha nova

    vi.restoreAllMocks()
```

Não precisa de teste novo nem de setup adicional — é a mesma transição de status que o teste já
exercita, só faltava conferir o campo novo.

- [ ] **Step 8: Rodar e confirmar que tudo passa**

```bash
pnpm --filter api exec vitest run src/modules/tasks/tasks.service.test.ts src/modules/task-documents
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/tasks apps/api/src/modules/task-documents
git commit -m "feat(metrics): completedAt + status_changed unificado nos 3 pontos de escrita de status"
```

---

## Task 4: `lateClosureThresholdDays` — schema/service/UI

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Modify: `apps/api/src/modules/notifications/notifications.routes.test.ts`
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`

**Interfaces:**
- Produces: `updateConfigSchema`/`getConfig` aceitam e retornam `lateClosureThresholdDays`.

- [ ] **Step 1: Teste de round-trip (RED)**

Adicionar em `notifications.routes.test.ts`, mesmo padrão dos testes de SLA já existentes:

```typescript
  it('persiste lateClosureThresholdDays e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { lateClosureThresholdDays: 5 },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({ method: 'GET', url: '/notifications/config', headers: { authorization: auth } })
    expect(JSON.parse(getRes.body).lateClosureThresholdDays).toBe(5)
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/modules/notifications/notifications.routes.test.ts -t "lateClosureThresholdDays"
```

- [ ] **Step 3: `notifications.schema.ts`** — adicionar em `updateConfigSchema`:

```typescript
  lateClosureThresholdDays: z.number().int().min(0).max(90).optional(),
```

- [ ] **Step 4: `notifications.service.ts`** — adicionar ao `select` de `getConfig`:

```typescript
      lateClosureThresholdDays: true,
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/modules/notifications/notifications.routes.test.ts
```

- [ ] **Step 6: UI em `Notifications.tsx`**

Na seção "Alertas de SLA" já existente, adicionar um terceiro input numérico ao lado dos dois
já existentes (`slaTargetWarningDays`/`slaDueCriticalDays`), mesmo padrão:

```tsx
<div className="space-y-1">
  <Label htmlFor="late-closure-days">Alerta de fechamento tardio (dias parados antes de concluir)</Label>
  <Input
    id="late-closure-days"
    type="number"
    min={0}
    max={90}
    value={form.lateClosureThresholdDays ?? 2}
    onChange={(e) => setForm({ ...form, lateClosureThresholdDays: Number(e.target.value) })}
  />
</div>
```

Adicionar `lateClosureThresholdDays?: number` na interface `Config` do topo do arquivo.

- [ ] **Step 7: Verificar**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/notifications apps/web/src/pages/app/settings/Notifications.tsx
git commit -m "feat(metrics): threshold de fechamento tardio configurável por organização"
```

---

## Task 5: `GET /dashboard/team-members` — lista leve pra filtro de pessoa

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.test.ts`

**Interfaces:**
- Produces: `getTeamMembers(organizationId): Promise<{id: string; name: string}[]>`, `GET
  /dashboard/team-members` (`ORG_ADMIN`/`ORG_MANAGER` only).

> Nota: `GET /users` já existe mas é restrito a `ORG_ADMIN` sozinho (gestão completa de usuário,
> inclusive e-mail/role — superfície sensível). Esse endpoint novo é deliberadamente mais estreito
> (só id+name, sem nada de gestão) e aberto também a `ORG_MANAGER`, que precisa popular o filtro de
> pessoa na tela de Produtividade sem herdar acesso de administração de usuários.

- [ ] **Step 1: Teste (RED)**

```typescript
// em dashboard.service.test.ts
describe('getTeamMembers', () => {
  it('lista id e nome dos usuários ativos da organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const result = await getTeamMembers(org.id)

    expect(result).toEqual([{ id: user.id, name: user.name }])
  })

  it('não inclui usuário de outra organização', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    await createTestUser(orgB.id)

    const result = await getTeamMembers(orgA.id)

    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/modules/dashboard/dashboard.service.test.ts -t "getTeamMembers"
```

- [ ] **Step 3: Implementar em `dashboard.service.ts`**

```typescript
export async function getTeamMembers(organizationId: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
```

- [ ] **Step 4: Rota em `dashboard.routes.ts`**

```typescript
import { getDashboardMetrics, getTeamMembers } from './dashboard.service'

  app.get('/team-members', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    return reply.send(await getTeamMembers(request.user.organizationId!))
  })
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/modules/dashboard
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/dashboard
git commit -m "feat(metrics): endpoint leve de membros da equipe pro filtro de pessoa"
```

---

## Task 6: `getProductivityMetrics` — cálculo das 5 métricas

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.types.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.test.ts`

**Interfaces:**
- Consumes: schema de `Task 1` (`completedAt`, `lateClosureThresholdDays`).
- Produces: `getProductivityMetrics(organizationId, query): Promise<ProductivityMetrics>`.

- [ ] **Step 1: Tipos em `dashboard.types.ts`**

```typescript
export interface ProductivityQuery {
  from: Date
  to: Date
  departmentId?: string
  userId?: string
  boardType?: 'OS' | 'RECURRING_SYSTEM'
}

export interface OnTimeBucket {
  onTime: number
  late: number
  applicable: number // denominador — quantas tarefas tinham a data de referência setada
}

export interface MetricsBreakdown {
  volume: { os: number; recurring: number }
  onTimeRate: { target: OnTimeBucket; due: OnTimeBucket }
  avgCompletionDays: { os: number | null; recurring: number | null }
  lateClosureCount: number
  currentLoad: { os: number; recurring: number }
  blocked: { taskCount: number; totalDays: number }
}

export interface PersonMetrics extends MetricsBreakdown { userId: string; userName: string }
export interface DepartmentMetrics extends MetricsBreakdown { departmentId: string; departmentName: string }

export interface ProductivityMetrics {
  period: { from: string; to: string }
  byPerson: PersonMetrics[]
  byDepartment: DepartmentMetrics[]
}
```

- [ ] **Step 2: Testes (RED)** — cobrindo os 5 pontos do Review Focus

No topo de `dashboard.service.test.ts`, adicionar `getProductivityMetrics` ao import já existente
de `dashboard.service` e `createTestDepartment` ao import já existente de `@/test/helpers` (ainda
não importado nesse arquivo):

```typescript
import { getDashboardMetrics, getProductivityMetrics } from '@/modules/dashboard/dashboard.service'
// ...e no bloco de '@/test/helpers', adicionar createTestDepartment à lista já existente

describe('getProductivityMetrics', () => {
  it('retorna zerado quando não há nenhuma tarefa no período', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await getProductivityMetrics(org.id, {
      from: new Date('2026-01-01'), to: new Date('2026-01-31'),
    })

    expect(result.byPerson).toEqual([])
    expect(result.byDepartment).toEqual([])
  })

  it('conta volume e cumprimento de vencimento de uma tarefa OS concluída dentro do prazo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    const dueDate = new Date('2026-06-20T00:00:00Z')
    const completedAt = new Date('2026-06-15T00:00:00Z') // antes do vencimento
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', dueDate, completedAt, assigneeId: user.id } })

    const result = await getProductivityMetrics(org.id, {
      from: new Date('2026-06-01'), to: new Date('2026-06-30'),
    })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.volume.os).toBe(1)
    expect(person.onTimeRate.due).toEqual({ onTime: 1, late: 0, applicable: 1 })
  })

  it('não conta meta (targetDate) no denominador quando a tarefa nunca teve targetDate (task OS comum)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE', completedAt: new Date('2026-06-15'), assigneeId: user.id, targetDate: null },
    })

    const result = await getProductivityMetrics(org.id, { from: new Date('2026-06-01'), to: new Date('2026-06-30') })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.onTimeRate.target.applicable).toBe(0)
  })

  it('conta tarefa ainda BLOCKED (sem evento de saída) até "agora" no tempo de impedimento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED', assigneeId: user.id } })
    const blockedSince = new Date()
    blockedSince.setUTCDate(blockedSince.getUTCDate() - 3)
    await prisma.taskHistory.create({
      data: {
        taskId: task.id, action: 'status_changed', fromValue: 'OPEN', toValue: 'BLOCKED',
        actorType: 'user', actorId: user.id, actorName: user.name, createdAt: blockedSince,
      },
    })

    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 30)
    const result = await getProductivityMetrics(org.id, { from, to: new Date() })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.blocked.taskCount).toBe(1)
    expect(person.blocked.totalDays).toBeGreaterThanOrEqual(2) // ~3 dias, com margem de arredondamento
  })

  it('ORG_MEMBER filtrando por departamento com outro colega só vê a própria linha (aplicado via userId forçado)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const me = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const colleague = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, me.id, { departmentId: dept.id })
    await createTestTask(column.id, colleague.id, { departmentId: dept.id })

    // Simula o que a rota faz: força userId = me.id mesmo com departmentId informado
    const result = await getProductivityMetrics(org.id, {
      from: new Date('2020-01-01'), to: new Date('2030-01-01'),
      departmentId: dept.id, userId: me.id,
    })

    expect(result.byPerson.every((p) => p.userId === me.id)).toBe(true)
  })

  it('não acusa fechamento tardio quando a tarefa foi concluída sem nenhum evento de histórico anterior', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)
    // só o evento "created" existe (gravado por createTestTask/service) — nada mais antes do completedAt
    await prisma.task.update({
      where: { id: task.id },
      data: { status: 'DONE', completedAt: new Date(), assigneeId: user.id },
    })

    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 1)
    const result = await getProductivityMetrics(org.id, { from, to: new Date() })

    const person = result.byPerson.find((p) => p.userId === user.id)!
    expect(person.lateClosureCount).toBe(0)
  })
})
```

> Nota: `createTestTask` não grava uma entrada `'created'` em `TaskHistory` automaticamente (esse
> helper chama `prisma.task.create` direto, não passa pelo service) — confirmar isso lendo
> `apps/api/src/test/helpers.ts` antes de assumir; se não gravar, o teste acima já teste o cenário
> "zero histórico antes do completedAt" organicamente, sem precisar de setup extra.

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/modules/dashboard/dashboard.service.test.ts -t "getProductivityMetrics"
```

- [ ] **Step 4: Implementar em `dashboard.service.ts`**

```typescript
import type { ProductivityQuery, ProductivityMetrics, MetricsBreakdown, OnTimeBucket } from './dashboard.types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function emptyBreakdown(): MetricsBreakdown {
  return {
    volume: { os: 0, recurring: 0 },
    onTimeRate: {
      target: { onTime: 0, late: 0, applicable: 0 },
      due: { onTime: 0, late: 0, applicable: 0 },
    },
    avgCompletionDays: { os: null, recurring: null },
    lateClosureCount: 0,
    currentLoad: { os: 0, recurring: 0 },
    blocked: { taskCount: 0, totalDays: 0 },
  }
}

function bucketKey(type: 'OS' | 'RECURRING_SYSTEM'): 'os' | 'recurring' {
  return type === 'OS' ? 'os' : 'recurring'
}

export async function getProductivityMetrics(
  organizationId: string,
  query: ProductivityQuery,
): Promise<ProductivityMetrics> {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  const lateClosureThresholdDays = config?.lateClosureThresholdDays ?? 2

  const baseWhere: Prisma.TaskWhereInput = {
    column: {
      board: {
        organizationId,
        ...(query.boardType ? { type: query.boardType } : {}),
      },
    },
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.userId ? { assigneeId: query.userId } : {}),
  }

  const taskSelect = {
    id: true,
    createdAt: true,
    completedAt: true,
    targetDate: true,
    dueDate: true,
    assigneeId: true,
    departmentId: true,
    assignee: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    column: { select: { board: { select: { type: true } } } },
  } satisfies Prisma.TaskSelect

  const [completedTasks, openTasks] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, completedAt: { gte: query.from, lte: query.to } },
      select: taskSelect,
    }),
    prisma.task.findMany({
      where: { ...baseWhere, status: { notIn: ['DONE', 'DISREGARDED'] } },
      select: taskSelect,
    }),
  ])

  // Tarefas candidatas a ter tido impedimento no período — qualquer task da org/filtro que já
  // teve status BLOCKED alguma vez (aberta agora, ou concluída dentro do período consultado).
  const candidateIds = [...new Set([...completedTasks, ...openTasks].map((t) => t.id))]
  const blockedHistory = candidateIds.length > 0
    ? await prisma.taskHistory.findMany({
        where: {
          action: 'status_changed',
          taskId: { in: candidateIds },
          OR: [{ toValue: 'BLOCKED' }, { fromValue: 'BLOCKED' }],
        },
        select: { taskId: true, fromValue: true, toValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []

  const fullHistoryForLateClosure = completedTasks.length > 0
    ? await prisma.taskHistory.findMany({
        where: { taskId: { in: completedTasks.map((t) => t.id) } },
        select: { taskId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : []

  const byPerson = new Map<string, { userId: string; userName: string; breakdown: MetricsBreakdown }>()
  const byDepartment = new Map<string, { departmentId: string; departmentName: string; breakdown: MetricsBreakdown }>()

  function ensurePerson(id: string, name: string) {
    if (!byPerson.has(id)) byPerson.set(id, { userId: id, userName: name, breakdown: emptyBreakdown() })
    return byPerson.get(id)!.breakdown
  }
  function ensureDept(id: string, name: string) {
    if (!byDepartment.has(id)) byDepartment.set(id, { departmentId: id, departmentName: name, breakdown: emptyBreakdown() })
    return byDepartment.get(id)!.breakdown
  }

  function targetsForTask(task: (typeof completedTasks)[number]): MetricsBreakdown[] {
    const targets: MetricsBreakdown[] = []
    if (task.assignee) targets.push(ensurePerson(task.assignee.id, task.assignee.name))
    targets.push(ensureDept(task.department.id, task.department.name))
    return targets
  }

  // Agrupa histórico de impedimento por taskId, uma vez, pra reconstruir intervalos sem reconsultar
  const historyByTask = new Map<string, typeof blockedHistory>()
  for (const h of blockedHistory) {
    const bucket = historyByTask.get(h.taskId) ?? []
    bucket.push(h)
    historyByTask.set(h.taskId, bucket)
  }

  const lateClosureHistoryByTask = new Map<string, typeof fullHistoryForLateClosure>()
  for (const h of fullHistoryForLateClosure) {
    const bucket = lateClosureHistoryByTask.get(h.taskId) ?? []
    bucket.push(h)
    lateClosureHistoryByTask.set(h.taskId, bucket)
  }

  const now = new Date()

  // --- Volume, prazo, tempo médio, fechamento tardio: só tarefas concluídas no período ---
  const completionDaysAccumulator = new Map<string, { os: number[]; recurring: number[] }>()
  function accDays(breakdown: MetricsBreakdown, key: string, days: number, type: 'os' | 'recurring') {
    const acc = completionDaysAccumulator.get(key) ?? { os: [], recurring: [] }
    acc[type].push(days)
    completionDaysAccumulator.set(key, acc)
  }

  for (const task of completedTasks) {
    const type = bucketKey(task.column.board.type)
    const targets = targetsForTask(task)

    for (const breakdown of targets) {
      breakdown.volume[type]++

      if (task.targetDate) {
        breakdown.onTimeRate.target.applicable++
        if (task.completedAt! <= task.targetDate) breakdown.onTimeRate.target.onTime++
        else breakdown.onTimeRate.target.late++
      }
      if (task.dueDate) {
        breakdown.onTimeRate.due.applicable++
        if (task.completedAt! <= task.dueDate) breakdown.onTimeRate.due.onTime++
        else breakdown.onTimeRate.due.late++
      }

      const completionDays = (task.completedAt!.getTime() - task.createdAt.getTime()) / MS_PER_DAY
      const accKey = task.assignee ? `p:${task.assignee.id}` : `d:${task.department.id}`
      accDays(breakdown, accKey, completionDays, type)

      // Fechamento tardio: último evento de histórico ANTES do completedAt, excluindo o próprio
      // instante de fechamento. Sem histórico anterior = gap 0 (nunca falso-positivo).
      const taskHistoryEntries = lateClosureHistoryByTask.get(task.id) ?? []
      const priorEntry = taskHistoryEntries.find((h) => h.createdAt.getTime() < task.completedAt!.getTime())
      const gapDays = priorEntry
        ? (task.completedAt!.getTime() - priorEntry.createdAt.getTime()) / MS_PER_DAY
        : 0
      if (gapDays > lateClosureThresholdDays) breakdown.lateClosureCount++
    }
  }

  // --- Carga atual: foto de agora, sem filtro de período ---
  for (const task of openTasks) {
    const type = bucketKey(task.column.board.type)
    for (const breakdown of targetsForTask(task)) {
      breakdown.currentLoad[type]++
    }
  }

  // --- Impedimento: reconstrói intervalos BLOCKED por task, clipa ao período consultado ---
  const allCandidateTasks = [...completedTasks, ...openTasks]
  const taskById = new Map(allCandidateTasks.map((t) => [t.id, t]))

  for (const [taskId, entries] of historyByTask) {
    const task = taskById.get(taskId)
    if (!task) continue

    let blockedSince: Date | null = null
    let totalClippedMs = 0
    for (const entry of entries) {
      if (entry.toValue === 'BLOCKED') blockedSince = entry.createdAt
      else if (entry.fromValue === 'BLOCKED' && blockedSince) {
        totalClippedMs += clippedDurationMs(blockedSince, entry.createdAt, query.from, query.to)
        blockedSince = null
      }
    }
    if (blockedSince) {
      // Ainda bloqueada no momento da consulta — conta até agora (ou até `query.to`, o que vier primeiro)
      totalClippedMs += clippedDurationMs(blockedSince, now, query.from, query.to)
    }

    if (totalClippedMs > 0) {
      for (const breakdown of targetsForTask(task)) {
        breakdown.blocked.taskCount++
        breakdown.blocked.totalDays += totalClippedMs / MS_PER_DAY
      }
    }
  }

  // Finaliza médias de tempo de conclusão (lista de dias -> média, ou null se vazio)
  for (const [key, acc] of completionDaysAccumulator) {
    const [kind, id] = key.split(':', 2) as ['p' | 'd', string]
    const breakdown = kind === 'p'
      ? byPerson.get(id)?.breakdown
      : byDepartment.get(id)?.breakdown
    if (!breakdown) continue
    breakdown.avgCompletionDays.os = average(acc.os)
    breakdown.avgCompletionDays.recurring = average(acc.recurring)
  }

  return {
    period: { from: query.from.toISOString(), to: query.to.toISOString() },
    byPerson: [...byPerson.values()].map((p) => ({ userId: p.userId, userName: p.userName, ...p.breakdown })),
    byDepartment: [...byDepartment.values()].map((d) => ({ departmentId: d.departmentId, departmentName: d.departmentName, ...d.breakdown })),
  }
}

function clippedDurationMs(start: Date, end: Date, from: Date, to: Date): number {
  const clippedStart = Math.max(start.getTime(), from.getTime())
  const clippedEnd = Math.min(end.getTime(), to.getTime())
  return Math.max(0, clippedEnd - clippedStart)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
```

> Nota de implementação: o `satisfies Prisma.TaskSelect` exige que `Prisma` esteja importado em
> `dashboard.service.ts` (`import { Prisma } from '@prisma/client'`, mesmo padrão já usado em
> `tasks.service.ts`) — adicionar esse import se ainda não existir no arquivo.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/modules/dashboard
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/dashboard
git commit -m "feat(metrics): getProductivityMetrics — volume, prazo, tempo, carga e impedimento"
```

---

## Task 7: `GET /dashboard/productivity` — rota + validação + controle de acesso

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.schema.ts` (hoje só tem um comentário — "No
  input validation needed — GET /dashboard/metrics has no body or query params", substituir pelo
  schema novo)
- Modify: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.routes.test.ts` (não existe ainda — só
  `dashboard.service.test.ts` existe hoje nesse módulo)

**Interfaces:**
- Consumes: `getProductivityMetrics` (Task 6).
- Produces: `GET /dashboard/productivity?from=&to=&departmentId=&userId=&boardType=`.

- [ ] **Step 1: Schema em `dashboard.schema.ts`**

```typescript
export const productivityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  departmentId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  boardType: z.enum(['OS', 'RECURRING_SYSTEM']).optional(),
})
```

(Criar o arquivo se não existir ainda — confirmar primeiro com `ls
apps/api/src/modules/dashboard/dashboard.schema.ts`.)

- [ ] **Step 2: Teste (RED)**

Arquivo novo — cabeçalho de imports:

```typescript
// apps/api/src/modules/dashboard/dashboard.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, getAuthHeader,
  createTestClient, createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

describe('GET /dashboard/productivity', () => {
  it('ORG_MEMBER não consegue ver produtividade de outro usuário mesmo passando o userId dele', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const me = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const colleague = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(me.email, 'Test@1234')
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, colleague.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date(), assigneeId: colleague.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/dashboard/productivity?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z&userId=${colleague.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.byPerson.find((p: { userId: string }) => p.userId === colleague.id)).toBeUndefined()
  })

  it('ORG_ADMIN consegue filtrar por outro usuário normalmente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, member.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date(), assigneeId: member.id } })

    const res = await app.inject({
      method: 'GET',
      url: `/dashboard/productivity?from=2020-01-01T00:00:00.000Z&to=2030-01-01T00:00:00.000Z&userId=${member.id}`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.byPerson.find((p: { userId: string }) => p.userId === member.id)).toBeDefined()
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api exec vitest run src/modules/dashboard/dashboard.routes.test.ts
```

- [ ] **Step 4: Implementar a rota**

```typescript
import { productivityQuerySchema } from './dashboard.schema'
import { getDashboardMetrics, getTeamMembers, getProductivityMetrics } from './dashboard.service'

  app.get('/productivity', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = productivityQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)

    const query = result.data
    // ORG_MEMBER nunca vê produtividade de outra pessoa — nem via userId de outro usuário, nem
    // indiretamente filtrando por um departamento com vários membros (a trava é aqui, não só na
    // UI escondendo o seletor).
    const forcedUserId = request.user.role === 'ORG_MEMBER' ? request.user.sub : query.userId

    return reply.send(await getProductivityMetrics(request.user.organizationId!, {
      from: new Date(query.from),
      to: new Date(query.to),
      departmentId: query.departmentId,
      userId: forcedUserId,
      boardType: query.boardType,
    }))
  })
```

Precisa importar `AppError` se ainda não estiver importado em `dashboard.routes.ts`.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/modules/dashboard
pnpm --filter api exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/dashboard
git commit -m "feat(metrics): GET /dashboard/productivity com controle de acesso por papel"
```

---

## Task 8: Frontend — abas no `DashboardMetrics.tsx`

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

**Interfaces:**
- Produces: abas "Visão geral"/"Produtividade", conteúdo atual preservado sem alteração visual
  dentro da primeira aba.

- [ ] **Step 1: Envolver o conteúdo existente em estado de aba**

O arquivo hoje importa só `useQuery`, `Link`, `api`, `cn` — adicionar `useState` de `'react'` no
topo (as outras três tasks desta seção vão precisar de mais imports: `useAuth`
de `@/hooks/useAuth`, na Task 9).

Seguir exatamente o padrão já usado em `apps/web/src/pages/app/settings/Notifications.tsx`
(`useState<'config'|'logs'>` + botões com `border-b-2`). Adaptar:

```tsx
import { useState } from 'react'
// ...imports existentes...

export default function DashboardMetrics() {
  const [tab, setTab] = useState<'overview' | 'productivity'>('overview')
  const { data, isLoading } = useQuery<Metrics>({ /* inalterado */ })

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Dashboard</h1>

      <div className="flex border-b border-border">
        {(['overview', 'productivity'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-[#185FA5] text-[#185FA5]' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'overview' ? 'Visão geral' : 'Produtividade'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        isLoading || !data ? (
          <div className="text-muted-foreground">Carregando métricas...</div>
        ) : (
          /* todo o JSX que já existe hoje dentro do return, de "KPI Cards" até o fim,
             sem nenhuma alteração — só movido pra dentro desta condicional */
          <OverviewContent data={data} />
        )
      )}

      {tab === 'productivity' && <ProductivityTab />}
    </div>
  )
}
```

Extrair o conteúdo atual (KPI cards + gráfico + painel em risco) pra uma função/componente
`OverviewContent({ data }: { data: Metrics })` no mesmo arquivo — é só mover o JSX existente,
nenhuma lógica muda. `ProductivityTab` é um componente vazio por enquanto (`<div>Em
construção</div>`), implementado nas Tasks 9-10.

- [ ] **Step 2: Verificar visualmente (sem teste automatizado — é reposicionamento de JSX)**

```bash
pnpm --filter web exec tsc --noEmit
```

QA manual rápido via Playwright: logar, abrir `/app/dashboard`, confirmar que "Visão geral" mostra
exatamente o que já mostrava antes (4 KPIs, gráfico, painel em risco), e que a aba "Produtividade"
existe e troca o conteúdo sem erro no console.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(metrics): abas Visão geral / Produtividade no Dashboard"
```

---

## Task 9: Frontend — filtros da aba Produtividade

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx` (`ProductivityTab`)

**Interfaces:**
- Consumes: `GET /dashboard/team-members`, `GET /departments`, `useAuth` (pra saber o papel).

- [ ] **Step 1: Implementar `ProductivityTab` — estado de filtros**

Adicionar ao topo do arquivo: `import { useAuth } from '@/hooks/useAuth'`.

```tsx
type Preset = '7d' | '30d' | '90d' | 'month' | 'custom'

function presetToRange(preset: Preset, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const now = new Date()
  if (preset === 'custom') {
    return {
      from: customFrom ? new Date(customFrom) : new Date(now.getFullYear(), now.getMonth(), 1),
      to: customTo ? new Date(customTo) : now,
    }
  }
  if (preset === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { from, to: now }
}

function ProductivityTab() {
  const { user } = useAuth()
  const isManagerOrAdmin = ['ORG_ADMIN', 'ORG_MANAGER'].includes(user?.role ?? '')

  const [preset, setPreset] = useState<Preset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [userId, setUserId] = useState('')
  const [boardType, setBoardType] = useState<'' | 'OS' | 'RECURRING_SYSTEM'>('')
  const [viewBy, setViewBy] = useState<'person' | 'department'>('person')

  const { from, to } = presetToRange(preset, customFrom, customTo)

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
    enabled: isManagerOrAdmin,
  })

  const { data: teamMembers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['dashboard-team-members'],
    queryFn: () => api.get('/dashboard/team-members').then((r) => r.data),
    enabled: isManagerOrAdmin,
  })

  const { data: metrics, isLoading } = useQuery<ProductivityMetrics>({
    queryKey: ['productivity-metrics', from.toISOString(), to.toISOString(), departmentId, userId, boardType],
    queryFn: () => api.get('/dashboard/productivity', {
      params: {
        from: from.toISOString(), to: to.toISOString(),
        ...(departmentId ? { departmentId } : {}),
        ...(userId ? { userId } : {}),
        ...(boardType ? { boardType } : {}),
      },
    }).then((r) => r.data),
  })

  const PRESET_LABEL: Record<Preset, string> = {
    '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', month: 'Mês atual', custom: 'Personalizado',
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['7d', '30d', '90d', 'month', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                preset === p ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="pm-from">De</Label>
              <Input id="pm-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-to">Até</Label>
              <Input id="pm-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}

        {isManagerOrAdmin && (
          <div className="space-y-1">
            <Label htmlFor="pm-department">Departamento</Label>
            <select
              id="pm-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
            >
              <option value="">Todos</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {isManagerOrAdmin && (
          <div className="space-y-1">
            <Label htmlFor="pm-person">Pessoa</Label>
            <select
              id="pm-person"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
            >
              <option value="">Todos</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="pm-boardtype">Tipo</Label>
          <select
            id="pm-boardtype"
            value={boardType}
            onChange={(e) => setBoardType(e.target.value as typeof boardType)}
            className="flex h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          >
            <option value="">OS + Recorrente</option>
            <option value="OS">Só OS</option>
            <option value="RECURRING_SYSTEM">Só Recorrente</option>
          </select>
        </div>

        {isManagerOrAdmin && (
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['person', 'department'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewBy(v)}
                className={cn(
                  'px-3 py-2 text-sm font-medium transition-colors',
                  viewBy === v ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
                )}
              >
                {v === 'person' ? 'Por pessoa' : 'Por departamento'}
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading || !metrics ? (
        <p className="text-muted-foreground">Carregando produtividade...</p>
      ) : (
        <ProductivityTable metrics={metrics} viewBy={isManagerOrAdmin ? viewBy : 'person'} />
      )}
    </div>
  )
}
```

`ProductivityTable` é o componente implementado na Task 10 (recebe `metrics` e `viewBy`, renderiza
a tabela + indicador de fechamento tardio). Adicionar ao topo do arquivo:
`import { Input } from '@/components/ui/input'` e `import { Label } from '@/components/ui/label'`.

Definir `ProductivityMetrics`/`MetricsBreakdown`/`OnTimeBucket`/`PersonMetrics`/
`DepartmentMetrics` no topo do arquivo, espelhando exatamente os tipos de `dashboard.types.ts`
(Task 6) — mesma convenção de duplicar tipo entre backend/frontend já usada em outras telas do
projeto (não há geração automática de tipos a partir do Zod/Prisma neste projeto). `OnTimeBucket`
é usado diretamente pelo `ProductivityTable` da Task 10 (`formatRate(bucket: OnTimeBucket)`).

- [ ] **Step 2: Verificar**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(metrics): filtros da aba Produtividade (período, departamento, pessoa, tipo)"
```

---

## Task 10: Frontend — tabela de métricas + lista de fechamento tardio

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

**Interfaces:**
- Consumes: resposta de `GET /dashboard/productivity` (Task 9).

- [ ] **Step 1: Componente `ProductivityTable`**

Implementa o componente referenciado pela Task 9 (`<ProductivityTable metrics={metrics}
viewBy={...} />`), no mesmo arquivo `DashboardMetrics.tsx`, abaixo de `ProductivityTab`:

```tsx
function formatRate(bucket: OnTimeBucket): string {
  if (bucket.applicable === 0) return 'N/A'
  return `${Math.round((bucket.onTime / bucket.applicable) * 100)}%`
}

function formatDays(days: number | null): string {
  return days === null ? '—' : days.toFixed(1)
}

function ProductivityTable({ metrics, viewBy }: { metrics: ProductivityMetrics; viewBy: 'person' | 'department' }) {
  const rows = viewBy === 'person' ? metrics.byPerson : metrics.byDepartment
  const lateClosureTotal = metrics.byPerson.reduce((sum, p) => sum + p.lateClosureCount, 0)

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase">
              <th className="text-left py-2 px-3">{viewBy === 'person' ? 'Pessoa' : 'Departamento'}</th>
              <th className="px-3">Volume (OS | Rec.)</th>
              <th className="px-3">% Meta</th>
              <th className="px-3">% Vencimento</th>
              <th className="px-3">Tempo médio (dias)</th>
              <th className="px-3">Carga atual (OS | Rec.)</th>
              <th className="px-3">Impedimento</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Nenhum dado no período selecionado</td></tr>
            ) : rows.map((row) => {
              const key = viewBy === 'person' ? (row as PersonMetrics).userId : (row as DepartmentMetrics).departmentId
              const label = viewBy === 'person' ? (row as PersonMetrics).userName : (row as DepartmentMetrics).departmentName
              return (
                <tr key={key} className="border-t border-border">
                  <td className="py-2 px-3">{label}</td>
                  <td className="text-center px-3">{row.volume.os} | {row.volume.recurring}</td>
                  <td className="text-center px-3">{formatRate(row.onTimeRate.target)}</td>
                  <td className="text-center px-3">{formatRate(row.onTimeRate.due)}</td>
                  <td className="text-center px-3">{formatDays(row.avgCompletionDays.os)} | {formatDays(row.avgCompletionDays.recurring)}</td>
                  <td className="text-center px-3">{row.currentLoad.os} | {row.currentLoad.recurring}</td>
                  <td className="text-center px-3">{row.blocked.taskCount} ({row.blocked.totalDays.toFixed(1)}d)</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {lateClosureTotal} tarefa(s) com indício de fechamento tardio no período.
      </p>
    </div>
  )
}
```

Lista detalhada com link por tarefa fica fora do escopo desta v1 — o backend não retorna os ids
das tarefas individuais, só o agregado; drill-down é extensão futura do endpoint.

- [ ] **Step 2: Verificar e QA manual**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
```

QA manual via Playwright: logar como admin, abrir aba Produtividade, trocar presets de período,
alternar OS/Recorrente/Ambos, alternar pessoa/departamento, confirmar que a tabela atualiza sem
erro de console. Logar como `ORG_MEMBER` de teste e confirmar que os seletores de
departamento/pessoa não aparecem e a tabela mostra só a própria linha.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(metrics): tabela de produtividade + indicador de fechamento tardio"
```

---

## Task 11: Verificação final e atualização do roadmap

**Files:**
- Review: toda a árvore tocada nas Tasks 1-10.
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Suites completas**

```bash
pnpm --filter api test
pnpm --filter web test
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 2: QA de ponta a ponta (Playwright)**

Fluxo completo: criar/concluir algumas tarefas de teste (OS e Recorrente, algumas dentro do prazo,
alguma com impedimento) → abrir Dashboard → aba Produtividade → conferir que os números batem com
o que foi criado → trocar de admin pra colaborador → confirmar isolamento de dado.

- [ ] **Step 3: Atualizar `docs/TASKS.md`**

Marcar o item 4 do roadmap como concluído, resumo curto do que foi entregue.

- [ ] **Step 4: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Métricas de produtividade como concluído no roadmap"
```
