# Usuários de Cliente com Acesso por Departamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `ClientUser` as the portal login entity (replacing `Client.email`/`passwordHash`), let one `ClientUser` access multiple client companies each scoped to specific departments, and make `Task.departmentId` mandatory so department-based visibility never depends on a missing value.

**Architecture:** New `ClientUser`/`ClientUserAccess` models; `Client` becomes company-only data. Auth's `login()` tries `User` then `ClientUser`. A new `client-access.ts` helper resolves "which companies/departments can this ClientUser see" on every portal request (not baked into the JWT). Every place that today treats `request.user.sub` as a `Client.id` (boards, comments, attachments, task-documents, portal profile/requests) is rewired to resolve the actual company id through that scope instead.

**Tech Stack:** Same as the rest of the repo — Fastify + Prisma + Zod (API), React + React Query + Tailwind tokens (web).

**Spec:** `docs/superpowers/specs/2026-09-21-client-users-design.md`

## Global Constraints

- TypeScript `strict: true`, no `any`, no `as unknown` (repo-wide convention).
- Zod validation on every route body/param.
- Errors via `AppError(statusCode, message)`.
- A `ClientUser` that can't see a task/board/comment/attachment gets `404`, never `403` — never reveal that something exists outside the caller's scope (existing convention already used for `visibleToClient`).
- Migrations are hand-written (never trust `prisma migrate dev`'s auto-diff for column type/nullability changes) and applied via `pnpm --filter api migrate:deploy` against **both** the dev DB (`DATABASE_URL`) and the test DB (`DATABASE_URL_TEST`, port 5433) before running tests.
- Comment/Attachment authorship stays at the **company** level (`Client.id`), not per-individual — this plan does **not** add `clientUserId` FKs to `Comment`/`Attachment`/`TaskHistory`. Any `ClientUser` with access to a company can act on that company's comments/attachments/documents, exactly like the single shared login could before. Display names for notifications use the individual `ClientUser.name` where convenient, but the stored FK is always the company.
- Every task in this plan must end with `pnpm --filter api test` and (where frontend files changed) `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web test` green, plus `pnpm --filter api exec tsc --noEmit` green.

---

## Task 1: Schema, migrations, auth cutover, and the shared access-scope helper

This is the foundational task — the DB schema for `Client` and `Task` changes in ways that make the *existing* code (not just new code) stop compiling/passing until `auth.service.ts`, `clients.schema/service.ts`, and `notification.worker.ts` are updated in the same commit. All of that lands here so the build stays green at every task boundary.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260921210000_client_users/migration.sql`
- Create: `apps/api/prisma/migrations/20260921210100_task_department_required/migration.sql`
- Create: `apps/api/src/modules/client-users/client-access.ts`
- Create: `apps/api/src/modules/client-users/client-access.test.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/clients/clients.schema.ts`
- Modify: `apps/api/src/modules/clients/clients.service.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`
- Modify: `apps/api/src/test/helpers.ts`
- Modify (mechanical, see Step 9): every test file that logs in as a `Client` or creates a raw `prisma.client.create({ data: { email, passwordHash, ... } })`

**Interfaces:**
- Produces: `getClientAccessScope(clientUserId: string): Promise<ClientAccessScope>`, `canSeeTask(scope, clientId, departmentId): boolean` — every later task that touches portal-facing code imports these from `@/modules/client-users/client-access`.
- Produces test helpers: `createTestClientUser(organizationId, overrides?): Promise<{ clientUser, password }>`, `grantClientAccess(clientUserId, clientId, departmentId): Promise<void>`.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Update `schema.prisma`**

Add the two new models right after `ClientAssignment` (so they sit near `Client`):

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

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
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

Add the back-relations:
- `Organization`: add `clientUsers ClientUser[]` next to `clients Client[]`.
- `Client`: **remove** `email` and `passwordHash` fields entirely. Add `clientUserAccesses ClientUserAccess[]` next to `clientAssignments`.
- `Department`: add `clientUserAccesses ClientUserAccess[]` next to `recurringTaskTemplates`.

Change `Task.departmentId` from `String?` to `String` (required), and `department Department? @relation(...)` to `department Department @relation(...)`.

Run `pnpm --filter api exec prisma format` after editing.

- [ ] **Step 2: Write migration `20260921210000_client_users`**

```sql
-- CreateTable
CREATE TABLE "client_users" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_users_email_organizationId_key" ON "client_users"("email", "organizationId");

-- CreateTable
CREATE TABLE "client_user_accesses" (
  "id" TEXT NOT NULL,
  "clientUserId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  CONSTRAINT "client_user_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_user_accesses_clientUserId_clientId_departmentId_key" ON "client_user_accesses"("clientUserId", "clientId", "departmentId");

-- AddForeignKey
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "client_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_user_accesses" ADD CONSTRAINT "client_user_accesses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropColumn: Client nunca teve dado real de login cadastrado (confirmado) —
-- login do portal passa a ser 100% via client_users.
ALTER TABLE "clients" DROP COLUMN "email";
ALTER TABLE "clients" DROP COLUMN "passwordHash";
```

- [ ] **Step 3: Write migration `20260921210100_task_department_required`**

```sql
-- Confirmado (2026-09-21): não há nenhuma tarefa de teste sem departamento em
-- nenhum ambiente hoje. Se essa suposição estiver errada em algum ambiente
-- compartilhado, esse ALTER falha alto e claro (erro de migration), nunca
-- corrompe dado — não há necessidade de backfill.
ALTER TABLE "tasks" ALTER COLUMN "departmentId" SET NOT NULL;
```

- [ ] **Step 4: Apply both migrations to dev and test DBs, regenerate client**

```bash
pnpm --filter api migrate:deploy
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  node -r dotenv/config apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
pnpm --filter api exec prisma generate
```

- [ ] **Step 5: Write `client-access.ts`**

```ts
// apps/api/src/modules/client-users/client-access.ts
import { prisma } from '@/lib/prisma'

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

- [ ] **Step 6: Test `client-access.ts`**

```ts
// apps/api/src/modules/client-users/client-access.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getClientAccessScope, canSeeTask } from './client-access'
import {
  createTestPlan, createTestOrg, createTestClient, createTestDepartment, createTestClientUser, grantClientAccess,
} from '@/test/helpers'

describe('getClientAccessScope', () => {
  it('groups departments by client from multiple access rows, across multiple companies', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const deptFiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const deptPessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
    const { clientUser } = await createTestClientUser(org.id)

    await grantClientAccess(clientUser.id, clientA.id, deptFiscal.id)
    await grantClientAccess(clientUser.id, clientA.id, deptPessoal.id)
    await grantClientAccess(clientUser.id, clientB.id, deptFiscal.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(scope.clientIds.sort()).toEqual([clientA.id, clientB.id].sort())
    expect(scope.departmentIdsByClient.get(clientA.id)).toEqual(new Set([deptFiscal.id, deptPessoal.id]))
    expect(scope.departmentIdsByClient.get(clientB.id)).toEqual(new Set([deptFiscal.id]))
  })

  it('returns empty scope for a ClientUser with no access rows', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const { clientUser } = await createTestClientUser(org.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(scope.clientIds).toEqual([])
  })
})

describe('canSeeTask', () => {
  it('returns true only for a client+department combo present in the scope', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id)
    const dept = await createTestDepartment(org.id)
    const otherDept = await createTestDepartment(org.id, { name: 'Outro' })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, dept.id)

    const scope = await getClientAccessScope(clientUser.id)

    expect(canSeeTask(scope, clientA.id, dept.id)).toBe(true)
    expect(canSeeTask(scope, clientA.id, otherDept.id)).toBe(false)
    expect(canSeeTask(scope, 'some-other-client-id', dept.id)).toBe(false)
  })
})
```

Verify: `pnpm --filter api exec vitest run src/modules/client-users/client-access.test.ts` — expect FAIL (helpers don't exist yet), then implement Step 8 and re-run to PASS.

- [ ] **Step 7: `auth.service.ts` — login via `ClientUser` instead of `Client`**

Replace the `Client` fallback block:

```ts
// Fall back to Client table
const client = await prisma.client.findFirst({
  where: { email },
  include: { organization: { select: { name: true } } },
})
if (client && (await verifyPassword(password, client.passwordHash))) {
  return buildSession(client.id, client.name, 'CLIENT', client.organizationId, client.organization?.name ?? null)
}
```

with:

```ts
// Fall back to ClientUser table (portal login)
const clientUser = await prisma.clientUser.findFirst({
  where: { email, isActive: true },
  include: { organization: { select: { name: true } } },
})
if (clientUser && (await verifyPassword(password, clientUser.passwordHash))) {
  return buildSession(clientUser.id, clientUser.name, 'CLIENT', clientUser.organizationId, clientUser.organization?.name ?? null)
}
```

`sub` in the JWT is now `clientUser.id`. Everything downstream keyed on `role === 'CLIENT'` is unaffected by this change alone (role string, `organizationId` shape are identical) — only code that additionally assumed `sub == client.id` breaks, which the rest of this task and Task 3/4/5 fix.

- [ ] **Step 8: `test/helpers.ts` — update `createTestClient`/`createTestTask`, add `createTestClientUser`/`grantClientAccess`**

`createTestClient` loses `email`:

```ts
export async function createTestClient(
  organizationId: string,
  overrides: Partial<{ isActive: boolean; name: string }> = {},
) {
  return prisma.client.create({
    data: {
      name: overrides.name ?? 'Test Client',
      organizationId,
      isActive: overrides.isActive ?? true,
    },
  })
}
```

`createTestTask` auto-creates (or reuses) a department for the task's org, so the 59 existing call sites across the test suite keep compiling and passing without every one of them having to specify a department explicitly (`departmentId` is now NOT NULL at the DB level):

```ts
export async function createTestTask(
  columnId: string,
  creatorId: string,
  overrides?: Partial<{ title: string; position: number; priority: string; departmentId: string }>,
) {
  const departmentId = overrides?.departmentId ?? (await defaultDepartmentForColumn(columnId))
  return prisma.task.create({
    data: {
      title: overrides?.title ?? 'Test Task',
      priority: (overrides?.priority as any) ?? 'MEDIUM',
      position: overrides?.position ?? 0,
      columnId,
      creatorId,
      departmentId,
    },
  })
}

async function defaultDepartmentForColumn(columnId: string): Promise<string> {
  const column = await prisma.column.findUniqueOrThrow({
    where: { id: columnId },
    select: { board: { select: { organizationId: true } } },
  })
  const organizationId = column.board.organizationId
  const existing = await prisma.department.findFirst({ where: { organizationId, name: 'Test Department (default)' } })
  if (existing) return existing.id
  const created = await prisma.department.create({ data: { organizationId, name: 'Test Department (default)' } })
  return created.id
}
```

New factories:

```ts
export async function createTestClientUser(
  organizationId: string,
  overrides?: Partial<{ name: string; email: string; password: string; isActive: boolean }>,
) {
  const password = overrides?.password ?? 'ClientUser@1234'
  const clientUser = await prisma.clientUser.create({
    data: {
      name: overrides?.name ?? 'Test Client User',
      email: overrides?.email ?? `client-user-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      isActive: overrides?.isActive ?? true,
      organizationId,
    },
  })
  return { clientUser, password }
}

export async function grantClientAccess(clientUserId: string, clientId: string, departmentId: string) {
  return prisma.clientUserAccess.create({ data: { clientUserId, clientId, departmentId } })
}
```

- [ ] **Step 9: Mechanical fix — every test that logs in as a `Client` or raw-creates one**

Find every occurrence:

```bash
grep -rln "prisma\.client\.create\|passwordHash.*await bcrypt\.hash" apps/api/src --include="*.test.ts"
```

For each match where the created record is a `Client` used to log in as `CLIENT` role (as opposed to `User`/`MASTER`), apply this transformation — replace:

```ts
const client = await prisma.client.create({
  data: {
    name: 'Cliente Teste',
    email: `worker-client-${Date.now()}@test.com`,
    passwordHash: await bcrypt.hash('pass', 4),
    whatsapp: '5582999990001',
    organizationId: org.id,
  },
})
```

with:

```ts
const client = await createTestClient(org.id, { name: 'Cliente Teste' })
const { clientUser, password: clientUserPassword } = await createTestClientUser(org.id)
const department = await createTestDepartment(org.id)
await grantClientAccess(clientUser.id, client.id, department.id)
```

(remove the manual `bcrypt.hash`/`prisma.client.create` import if it becomes unused in that file), and everywhere that file later does `getAuthHeader(client.email, '...')` change to `getAuthHeader(clientUser.email, clientUserPassword)`. Any test that creates a `task`/`board` and expects it visible to that client must also make sure the task's `departmentId` is `department.id` (via `createTestTask(col.id, creator.id, { departmentId: department.id })`) or, if it doesn't care which department, just relies on `createTestTask`'s Step-8 auto-default — **only set it explicitly when the test's assertion actually depends on the department value**.

Files known to need this (from `grep -rln "client\.email\|passwordHash.*hash.*pass\|prisma\.client\.create" apps/api/src --include="*.test.ts"` at spec time — re-run the grep, this list is a starting point, not exhaustive):
`workers/notification-worker.test.ts`, `modules/auth/auth.service.test.ts`, `modules/auth/auth.routes.test.ts`, `modules/requests/requests.routes.test.ts`, `modules/comments/comments.routes.test.ts`, `modules/comments/comments.service.test.ts`, `modules/portal/portal.routes.test.ts`.

Also fix the plain `createTestClient(org.id, { email: '...' })` call sites (no login involved, just used as a distinguishing label) — replace `email:` with `name:` using the same string, e.g. `createTestClient(org.id, { email: 'anexo-a@test.com' })` → `createTestClient(org.id, { name: 'anexo-a@test.com' })`. Files: `modules/requests/request-attachments.service.test.ts`, `modules/clients/clients.service.test.ts`, `modules/requests/requests.service.test.ts`.

- [ ] **Step 10: `clients.schema.ts` — remove `email`/`password`**

```ts
export const createClientSchema = z.object({
  name: z.string().min(2),
  clientType: z.enum(['PF', 'PJ']).default('PJ'),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  ...addressFields,
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  clientType: z.enum(['PF', 'PJ']).optional(),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  ...addressFields,
})
```

(`email`/`password` lines removed, `addressFields` block from the earlier CNPJ-lookup feature stays untouched.)

- [ ] **Step 11: `clients.service.ts` — drop email dedup + login fields**

Remove the `SELECT` object's now-nonexistent `email: true` line. Remove the duplicate-email check and `hashPassword`/`passwordHash`/`email` from `createClient`'s `data`:

```ts
export async function createClient(organizationId: string, data: CreateClientBody) {
  return prisma.client.create({
    data: {
      name: data.name,
      clientType: data.clientType ?? 'PJ',
      cnpj: data.cnpj,
      cpf: data.cpf,
      whatsapp: data.whatsapp,
      phone: data.phone,
      notes: data.notes,
      cep: data.cep,
      estado: data.estado,
      cidade: data.cidade,
      bairro: data.bairro,
      logradouro: data.logradouro,
      numero: data.numero,
      complemento: data.complemento,
      organizationId,
    },
    select: SELECT,
  })
}
```

Remove the now-unused `hashPassword` import if nothing else in the file uses it.

Update `clients.service.test.ts`: delete the `'creates a client with hashed password...'` and `'throws 409 when email is already registered...'`/`'allows the same email across different organizations'` tests (email/password no longer exist on `Client`) — replace with one straightforward creation assertion:

```ts
it('creates a client scoped to the organization', async () => {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)

  const result = await createClient(org.id, { name: 'Cliente Novo', clientType: 'PJ' })

  expect(result.clientType).toBe('PJ')
  const stored = await prisma.client.findUnique({ where: { id: result.id } })
  expect(stored?.organizationId).toBe(org.id)
})
```

Also update every other `createClient(org.id, { ..., email: ..., password: ... })` call across `clients.service.test.ts`/`clients.routes.test.ts` — drop the `email`/`password` keys from every call.

- [ ] **Step 12: `notification.worker.ts` — email fan-out across `ClientUser`s**

Replace the single `client.email` send with one send per active `ClientUser` that has *any* access row for this `clientId` (department-agnostic for now — a request/task-moved notification isn't always tied to one department the way a task's own departmentId is; keeping it simple: "anyone in the company who has access to at least one department of this company" gets notified, matching the pre-existing behavior where the single shared login always got every notification for its company):

```ts
} else {
  const recipients = await prisma.clientUser.findMany({
    where: { isActive: true, accesses: { some: { clientId } } },
    select: { id: true, name: true, email: true },
    distinct: ['id'],
  })
  for (const recipient of recipients) {
    const subject = renderTemplate(template.subject ?? '', vars)
    try {
      await sendEmail(
        recipient.email,
        subject,
        rendered,
        wrapEmailHtml(subject, rendered, vars.portalUrl, 'Acessar portal'),
      )
      status = 'SENT'
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
    }
    await prisma.notificationLog.create({
      data: {
        organizationId, clientId, event: event as NotificationEvent, channel, taskId, requestId,
        recipient: recipient.email, message: rendered, status, error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
  continue // já logou por destinatário acima — pula o log único do fim do loop
}
```

This needs restructuring the surrounding `for (const channel of effectiveChannels)` loop slightly: the `WHATSAPP` branch keeps sending once to `client.whatsapp` (company-level, unchanged) and logging once at the loop's existing tail; the `EMAIL` branch now loops internally over recipients and logs per-recipient, then `continue`s past the loop's shared tail-log statement. Read the full current function body first (`apps/api/src/workers/notification.worker.ts`) and restructure precisely — the `try/catch` that currently wraps a single send needs to move inside the per-recipient loop for `EMAIL` only.

Update `notification-worker.test.ts`: replace the raw `prisma.client.create({ email, passwordHash, ... })` setup (per Step 9's pattern) with `createTestClient` + `createTestClientUser` + `grantClientAccess`, and assert `sendEmail` was called once per `ClientUser` with access (not once with `client.email`).

- [ ] **Step 13: Run the full suite, fix anything the mechanical sweep missed**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
```

Iterate on Step 9's mechanical fix until both are green. This is the task's actual completion gate — don't move to Task 2 with red tests.

- [ ] **Step 14: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/client-users apps/api/src/modules/auth apps/api/src/modules/clients apps/api/src/workers/notification.worker.ts apps/api/src/test/helpers.ts <every test file touched in Step 9/12>
git commit -m "feat(client-users): schema foundation, auth cutover, access-scope helper"
```

---

## Task 2: `client-users` backend module (CRUD)

**Files:**
- Create: `apps/api/src/modules/client-users/client-users.schema.ts`
- Create: `apps/api/src/modules/client-users/client-users.service.ts`
- Create: `apps/api/src/modules/client-users/client-users.routes.ts`
- Create: `apps/api/src/modules/client-users/client-users.service.test.ts`
- Create: `apps/api/src/modules/client-users/client-users.routes.test.ts`
- Modify: `apps/api/src/server.ts` (or wherever routes are registered — same pattern as `recurringTemplatesRoutes`)

**Interfaces:**
- Consumes: `getClientAccessScope`/`canSeeTask` unused here (this module only manages the join rows, doesn't read scope); reuses `hashPassword`/`verifyPassword` from `@/modules/auth/auth.service`, and `assertDepartmentBelongsToOrg` from `@/modules/departments/departments.service` (existing helper, same guard pattern as `recurring-templates.service.ts`).
- Produces: `GET/POST/PATCH/DELETE /client-users` — consumed by the frontend in Task 6.

- [ ] **Step 1: `client-users.schema.ts`**

```ts
import { z } from 'zod'

const accessSchema = z.object({
  clientId: z.string().cuid(),
  departmentId: z.string().cuid(),
})

export const createClientUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  isActive: z.boolean().default(true),
  accesses: z.array(accessSchema).min(1, 'Selecione pelo menos um cliente e departamento'),
})

export const updateClientUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  accesses: z.array(accessSchema).min(1, 'Selecione pelo menos um cliente e departamento').optional(),
})

export type CreateClientUserBody = z.infer<typeof createClientUserSchema>
export type UpdateClientUserBody = z.infer<typeof updateClientUserSchema>
```

- [ ] **Step 2: `client-users.service.ts`**

```ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateClientUserBody, UpdateClientUserBody } from './client-users.schema'

const SELECT = {
  id: true, name: true, email: true, phone: true, isActive: true, createdAt: true,
  accesses: {
    select: {
      id: true,
      clientId: true,
      departmentId: true,
      client: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
}

async function assertAccessesBelongToOrg(accesses: { clientId: string; departmentId: string }[], organizationId: string) {
  const clientIds = [...new Set(accesses.map((a) => a.clientId))]
  const departmentIds = [...new Set(accesses.map((a) => a.departmentId))]

  const [clients, departments] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds }, organizationId }, select: { id: true } }),
    prisma.department.findMany({ where: { id: { in: departmentIds }, organizationId }, select: { id: true } }),
  ])

  if (clients.length !== clientIds.length) throw new AppError(404, 'Cliente não encontrado')
  if (departments.length !== departmentIds.length) throw new AppError(404, 'Departamento não encontrado')
}

export async function listClientUsers(organizationId: string) {
  return prisma.clientUser.findMany({
    where: { organizationId },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

export async function getClientUserById(id: string, organizationId: string) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId }, select: SELECT })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')
  return clientUser
}

export async function createClientUser(organizationId: string, data: CreateClientUserBody) {
  const existing = await prisma.clientUser.findFirst({ where: { email: data.email, organizationId } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')

  await assertAccessesBelongToOrg(data.accesses, organizationId)

  return prisma.clientUser.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      phone: data.phone,
      isActive: data.isActive,
      organizationId,
      accesses: { create: data.accesses },
    },
    select: SELECT,
  })
}

export async function updateClientUser(id: string, organizationId: string, data: UpdateClientUserBody) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId } })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')

  if (data.email && data.email !== clientUser.email) {
    const existing = await prisma.clientUser.findFirst({ where: { email: data.email, organizationId } })
    if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')
  }

  if (data.accesses) await assertAccessesBelongToOrg(data.accesses, organizationId)

  return prisma.$transaction(async (tx) => {
    await tx.clientUser.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        isActive: data.isActive,
        ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
      },
    })

    if (data.accesses) {
      await tx.clientUserAccess.deleteMany({ where: { clientUserId: id } })
      await tx.clientUserAccess.createMany({ data: data.accesses.map((a) => ({ clientUserId: id, ...a })) })
    }

    return tx.clientUser.findUniqueOrThrow({ where: { id }, select: SELECT })
  })
}

export async function deleteClientUser(id: string, organizationId: string) {
  const clientUser = await prisma.clientUser.findFirst({ where: { id, organizationId } })
  if (!clientUser) throw new AppError(404, 'Usuário de cliente não encontrado')

  return prisma.clientUser.update({ where: { id }, data: { isActive: false }, select: SELECT })
}
```

- [ ] **Step 3: `client-users.routes.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createClientUserSchema, updateClientUserSchema } from './client-users.schema'
import { listClientUsers, getClientUserById, createClientUser, updateClientUser, deleteClientUser } from './client-users.service'

export async function clientUsersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN', 'ORG_MANAGER'))

  app.get('/', async (request, reply) => {
    return reply.send(await listClientUsers(request.user.organizationId!))
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getClientUserById(id, request.user.organizationId!))
  })

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createClientUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClientUser(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientUser(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClientUser(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 4: register the route**

Find where `recurringTemplatesRoutes` (or `departmentsRoutes`) is registered (grep `app.register(.*[Rr]outes` in `apps/api/src/server.ts` or `app.ts`) and add, following the exact same prefix convention:

```ts
app.register(clientUsersRoutes, { prefix: '/client-users' })
```

- [ ] **Step 5: `client-users.service.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  listClientUsers, getClientUserById, createClientUser, updateClientUser, deleteClientUser,
} from './client-users.service'
import { createTestPlan, createTestOrg, createTestClient, createTestDepartment } from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const client = await createTestClient(org.id)
  const department = await createTestDepartment(org.id)
  return { org, client, department }
}

describe('createClientUser', () => {
  it('creates a client user with hashed password and the given accesses', async () => {
    const { org, client, department } = await setup()

    const result = await createClientUser(org.id, {
      name: 'Viviane', email: `viviane-${Date.now()}@test.com`, password: 'Senha@1234',
      isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    expect(result.accesses).toHaveLength(1)
    const stored = await prisma.clientUser.findUnique({ where: { id: result.id } })
    expect(stored?.passwordHash).not.toBe('Senha@1234')
  })

  it('throws 409 when email is already registered in the same organization', async () => {
    const { org, client, department } = await setup()
    const email = `dup-${Date.now()}@test.com`
    await createClientUser(org.id, { name: 'A', email, password: 'Senha@1234', isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }] })

    await expect(
      createClientUser(org.id, { name: 'B', email, password: 'Senha@1234', isActive: true, accesses: [{ clientId: client.id, departmentId: department.id }] }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 when a client in accesses belongs to a different organization', async () => {
    const { org, department } = await setup()
    const plan2 = await createTestPlan()
    const otherOrg = await createTestOrg(plan2.id)
    const foreignClient = await createTestClient(otherOrg.id)

    await expect(
      createClientUser(org.id, {
        name: 'X', email: `x-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
        accesses: [{ clientId: foreignClient.id, departmentId: department.id }],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateClientUser', () => {
  it('replaces the accesses list entirely when accesses is provided', async () => {
    const { org, client, department } = await setup()
    const department2 = await createTestDepartment(org.id, { name: 'Outro' })
    const created = await createClientUser(org.id, {
      name: 'C', email: `c-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    const updated = await updateClientUser(created.id, org.id, {
      accesses: [{ clientId: client.id, departmentId: department2.id }],
    })

    expect(updated.accesses).toHaveLength(1)
    expect(updated.accesses[0].departmentId).toBe(department2.id)
  })

  it('does not change the password when password is omitted', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'D', email: `d-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })
    const before = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })

    await updateClientUser(created.id, org.id, { name: 'D Editado' })

    const after = await prisma.clientUser.findUniqueOrThrow({ where: { id: created.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })
})

describe('deleteClientUser', () => {
  it('soft-deletes (isActive=false) instead of removing the row', async () => {
    const { org, client, department } = await setup()
    const created = await createClientUser(org.id, {
      name: 'E', email: `e-${Date.now()}@test.com`, password: 'Senha@1234', isActive: true,
      accesses: [{ clientId: client.id, departmentId: department.id }],
    })

    await deleteClientUser(created.id, org.id)

    const stored = await getClientUserById(created.id, org.id)
    expect(stored.isActive).toBe(false)
  })
})
```

- [ ] **Step 6: `client-users.routes.test.ts`**

Follow the exact pattern of `apps/api/src/modules/departments/departments.routes.test.ts` or `recurring-templates` routes test (dispatch `app.inject` with `getAuthHeader`) — cover: `POST /client-users` as `ORG_ADMIN` succeeds (201), as `ORG_MEMBER` gets 403, `GET /client-users` lists only the caller's org, `PATCH`/`DELETE` scoped to org (404 for another org's id).

- [ ] **Step 7: Run suite, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
git add apps/api/src/modules/client-users apps/api/src/server.ts
git commit -m "feat(client-users): CRUD module for portal users and their client+department access"
```

---

## Task 3: Department-aware access resolution in comments, attachments, task-documents

**Files:**
- Modify: `apps/api/src/modules/comments/comments.service.ts`
- Modify: `apps/api/src/modules/attachments/attachments.service.ts`
- Modify: `apps/api/src/modules/task-documents/task-documents.service.ts`
- Modify: their `.test.ts` counterparts

**Interfaces:**
- Consumes: `getClientAccessScope`, `canSeeTask` from Task 1.
- Produces: nothing new externally — route signatures (`comments.routes.ts`, `attachments.routes.ts`, `portal.routes.ts`) are **unchanged** by this task; they keep passing `request.user.sub` exactly as before. The services internally now treat that `sub` as a `clientUserId` when `role === 'CLIENT'` and resolve the real `Client.id` themselves.

- [ ] **Step 1: `comments.service.ts` — `listComments`**

Replace the function body:

```ts
export async function listComments(
  taskId: string,
  organizationId: string,
  role: string,
  clientUserId?: string,
) {
  const isClient = role === 'CLIENT' && !!clientUserId
  const scope = isClient ? await getClientAccessScope(clientUserId!) : undefined

  const boardWhere = isClient
    ? { organizationId, clientId: { in: scope!.clientIds } }
    : { organizationId }

  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  if (isClient && (!task.visibleToClient || !canSeeTask(scope!, task.column.board.clientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }

  const comments = await prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  const canSeeDeleted = CAN_SEE_DELETED_CONTENT.has(role)

  return comments.map((c) => {
    if (!c.deletedAt) return c
    return { ...c, content: null, ...(canSeeDeleted ? { deletedContent: c.content } : {}) }
  })
}
```

Add the import: `import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'`.

- [ ] **Step 2: `comments.service.ts` — `createComment`**

`CommentActor.id` is now a `clientUserId` when `actor.role === 'CLIENT'`. Resolve the real `board.clientId` and use *that* for the `Comment.clientId` FK and for the notification's `clientAssignment` lookup (which today does `clientId: actor.id` — must become `clientId: resolvedClientId`):

```ts
export async function createComment(taskId: string, data: CreateCommentBody, actor: CommentActor) {
  const isClient = actor.role === 'CLIENT'
  const scope = isClient ? await getClientAccessScope(actor.id) : undefined

  const boardWhere = isClient
    ? { organizationId: actor.organizationId, clientId: { in: scope!.clientIds } }
    : { organizationId: actor.organizationId }

  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { id: true, clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  const resolvedClientId = task.column.board.clientId
  if (isClient && (!task.visibleToClient || !canSeeTask(scope!, resolvedClientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }

  const comment = await prisma.comment.create({
    data: {
      content: data.content,
      taskId,
      authorType: isClient ? 'CLIENT' : 'USER',
      userId: isClient ? undefined : actor.id,
      clientId: isClient ? resolvedClientId : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  await publishBoardEvent(task.column.board.id, { event: 'comment:added', data: { taskId, commentId: comment.id } })

  const authorName = isClient
    ? ((await prisma.clientUser.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Cliente')
    : (comment.user?.name ?? 'Colaborador')

  if (isClient) {
    const assignments = await prisma.clientAssignment.findMany({
      where: task.departmentId
        ? { clientId: resolvedClientId, departmentId: task.departmentId }
        : { clientId: resolvedClientId },
      select: { userId: true },
    })
    const recipientIds = assignments.length > 0
      ? assignments.map((a) => a.userId)
      : await prisma.user.findMany({
          where: { organizationId: actor.organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
          select: { id: true },
        }).then((users) => users.map((u) => u.id))

    await Promise.all(
      recipientIds.map((userId) =>
        enqueueNotification({
          event: 'TASK_COMMENT_ADDED', taskId, organizationId: actor.organizationId,
          recipientType: 'USER', userId,
          metadata: { taskTitle: task.title, commentText: data.content, commentAuthorName: authorName },
        }),
      ),
    )
  } else {
    await enqueueNotification({
      event: 'TASK_COMMENT_ADDED', taskId, organizationId: actor.organizationId,
      clientId: resolvedClientId,
      metadata: { taskTitle: task.title, commentText: data.content, commentAuthorName: authorName },
    })
  }

  return comment
}
```

- [ ] **Step 3: `comments.service.ts` — `deleteComment`**

The `isAuthor` check and the client-board-ownership check both compared `actor.id` (now a `clientUserId`) against `Client.id`-typed fields. Company-level authorship (per Global Constraints): any `ClientUser` with access to the company that owns the comment can delete it — mirrors the pre-existing single-shared-login behavior.

```ts
export async function deleteComment(id: string, actor: CommentActor) {
  const comment = await prisma.comment.findFirst({
    where: { id },
    include: { task: { include: { column: { include: { board: { select: { organizationId: true, clientId: true } } } } } } },
  })
  if (!comment) throw new AppError(404, 'Comentário não encontrado')
  if (comment.deletedAt) throw new AppError(410, 'Comentário já foi removido')
  if (comment.task.column.board.organizationId !== actor.organizationId) throw new AppError(403, 'Acesso negado')

  if (actor.role === 'CLIENT') {
    const scope = await getClientAccessScope(actor.id)
    if (!scope.clientIds.includes(comment.task.column.board.clientId)) throw new AppError(403, 'Acesso negado')
  }

  const isAuthor =
    (actor.role === 'CLIENT' && comment.clientId === comment.task.column.board.clientId) ||
    (actor.role !== 'CLIENT' && comment.userId === actor.id)
  const isAdmin = actor.role === 'ORG_ADMIN' || actor.role === 'ORG_MANAGER'
  if (!isAuthor && !isAdmin) throw new AppError(403, 'Sem permissão')

  await prisma.comment.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: actor.id, deletedByType: actor.role === 'CLIENT' ? 'CLIENT' : 'USER' },
  })
  return { ok: true }
}
```

(`deletedBy` stays `actor.id` — now a `clientUserId` — which is fine, it's a free-text audit field, not a FK.)

- [ ] **Step 4: `attachments.service.ts` — the same treatment**

`verifyTaskBelongsToOrg` gains scope resolution when a client is calling:

```ts
async function verifyTaskBelongsToOrg(taskId: string, organizationId: string, clientUserId?: string) {
  const scope = clientUserId ? await getClientAccessScope(clientUserId) : undefined
  const boardWhere = scope ? { organizationId, clientId: { in: scope.clientIds } } : { organizationId }
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  if (scope && (!task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task // task.column.board.clientId is the resolved company id
}
```

`resolveActorName` for a client actor now looks up `ClientUser`, not `Client`:

```ts
async function resolveActorName(actor: UploaderActor): Promise<string> {
  if (actor.role === 'CLIENT') {
    return (await prisma.clientUser.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Cliente'
  }
  return (await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'Colaborador'
}
```

`createAttachment` resolves the real `clientId` for the FK (was `actor.id` directly):

```ts
export async function createAttachment(taskId: string, organizationId: string, actor: UploaderActor, payload: UploadPayload) {
  const isClient = actor.role === 'CLIENT'
  const task = await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)
  const resolvedClientId = task.column.board.clientId

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `attachments/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const actorName = await resolveActorName(actor)

  const [attachment] = await prisma.$transaction([
    prisma.attachment.create({
      data: {
        taskId, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, storageKey,
        uploadedBy: isClient ? undefined : actor.id,
        uploadedByClient: isClient ? resolvedClientId : undefined,
      },
    }),
    prisma.taskHistory.create({
      data: { taskId, action: 'attachment_added', toValue: payload.filename, actorType: isClient ? 'client' : 'user', actorId: actor.id, actorName },
    }),
  ])

  return attachment
}
```

`listAttachments(taskId, organizationId, clientUserId?)` — same `verifyTaskBelongsToOrg` swap, no other change needed (it already only reads).

`deleteAttachment` — company-level authorship, same principle as comments:

```ts
export async function deleteAttachment(attachmentId: string, taskId: string, organizationId: string, actor: UploaderActor) {
  const isClient = actor.role === 'CLIENT'
  const task = await verifyTaskBelongsToOrg(taskId, organizationId, isClient ? actor.id : undefined)

  const attachment = await prisma.attachment.findFirst({ where: { id: attachmentId, taskId, deletedAt: null } })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  if (isClient && attachment.uploadedByClient !== task.column.board.clientId) {
    throw new AppError(403, 'Sem permissão para remover este anexo')
  }

  const actorName = await resolveActorName(actor)
  // ...restante da função inalterado (soft-delete + storageKey removal do B2 + taskHistory)
}
```

Read the rest of `deleteAttachment`'s current body (it continues past what was shown when this plan was written — soft-delete + B2 file removal + `taskHistory` entry) and keep it unchanged below the permission check.

- [ ] **Step 5: `task-documents.service.ts` — `verifyTaskAccess`**

```ts
export async function verifyTaskAccess(taskId: string, organizationId: string, clientUserId?: string) {
  const scope = clientUserId ? await getClientAccessScope(clientUserId) : undefined
  const boardWhere = scope ? { organizationId, clientId: { in: scope.clientIds } } : { organizationId }
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: boardWhere } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  if (scope && (!task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId))) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task
}
```

`uploadForRequirement`'s `actor: { id: string; type: 'user' | 'client' }` + separate `clientId` param — the `clientId` param it receives from the route is still `request.user.sub` (a `clientUserId` now). Resolve the real company id via the `verifyTaskAccess` call it already makes, and use *that* for `uploadedByClient` instead of `actor.id`:

```ts
export async function uploadForRequirement(
  taskId: string, requirementId: string, organizationId: string,
  actor: { id: string; type: 'user' | 'client' }, clientUserId: string | undefined, payload: UploadPayload,
) {
  const task = await verifyTaskAccess(taskId, organizationId, clientUserId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, storageKey,
      uploadedBy: actor.type === 'user' ? actor.id : undefined,
      uploadedByClient: actor.type === 'client' ? task.column.board.clientId : undefined,
    },
  })

  await prisma.taskDocumentRequirement.update({
    where: { id: requirementId },
    data: { status: 'UPLOADED', attachmentId: attachment.id, rejectionReason: null },
  })
  await recalculateTaskStatus(taskId)
  return prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { attachment: true } })
}
```

`listTaskDocuments(taskId, organizationId, clientUserId?)` just forwards to `verifyTaskAccess` — no other change.

- [ ] **Step 6: Update the three `.test.ts` files**

Same mechanical transformation as Task 1 Step 9: any test that previously did
`getAuthHeader(client.email, '...')` and expected `Comment.clientId`/`Attachment.uploadedByClient` to equal that client's id needs `createTestClientUser` + `grantClientAccess` + asserting against `client.id` (the company, unchanged expectation) while logging in with `clientUser.email`. Add one new test per service explicitly covering the negative case: a `ClientUser` with access to `clientA`+`deptFiscal` gets `404` when hitting a task that belongs to `clientA` but is tagged `deptPessoal`.

- [ ] **Step 7: Run suite, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
git add apps/api/src/modules/comments apps/api/src/modules/attachments apps/api/src/modules/task-documents
git commit -m "feat(client-users): department-aware access checks in comments, attachments, task-documents"
```

---

## Task 4: Boards — multi-company + department filtering

**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/boards/boards.routes.ts`
- Modify: `apps/api/src/modules/boards/boards.service.test.ts`, `boards.routes.test.ts`

**Interfaces:**
- Consumes: `getClientAccessScope`, `canSeeTask` from Task 1.
- Produces: `listBoards`/`getBoardById` accept `clientId?: string | string[]` (widened from `string`) — Task 5's portal profile/requests work doesn't touch boards, so nothing downstream of this task needs to know about the widening besides the route itself.

- [ ] **Step 1: `listBoards` — accept an array of client ids**

```ts
export async function listBoards(
  organizationId: string,
  query: {
    clientId?: string | string[]
    responsibleUserId?: string
    columnTitle?: string
    overdue?: boolean
    dueSoon?: boolean
  } = {},
) {
  const now = new Date()
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(query.clientId
        ? { clientId: Array.isArray(query.clientId) ? { in: query.clientId } : query.clientId }
        : {}),
      ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}),
      // ...restante do where (columnTitle/overdue/dueSoon) inalterado
    },
    include: {
      client: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: { orderBy: { position: 'asc' }, include: { tasks: { orderBy: { position: 'asc' } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Step 2: `getBoardById` — same widening, no department filtering inside the query**

```ts
export async function getBoardById(
  id: string,
  organizationId: string,
  hideInvisibleTasks = false,
  clientId?: string | string[],
) {
  const board = await prisma.board.findFirst({
    where: {
      id, organizationId, isActive: true,
      ...(clientId ? { clientId: Array.isArray(clientId) ? { in: clientId } : clientId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { where: hideInvisibleTasks ? { visibleToClient: true } : undefined, orderBy: { position: 'asc' } } },
      },
    },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')
  return board
}
```

(Department filtering happens in the route, Step 4 below — not here — because `getBoardById` doesn't know the caller's per-client department scope, only the route does after resolving it.)

- [ ] **Step 3: `boards.routes.ts` — list endpoint**

```ts
if (role === 'CLIENT') {
  const scope = await getClientAccessScope(sub)
  return reply.send(await listBoards(organizationId!, { clientId: scope.clientIds }))
}
```

Add the import: `import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'`.

- [ ] **Step 4: `boards.routes.ts` — detail endpoint (department post-filter)**

```ts
app.get('/:id', {
  preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
}, async (request, reply) => {
  const { id } = request.params as { id: string }
  const isClient = request.user.role === 'CLIENT'

  if (!isClient) {
    return reply.send(await getBoardById(id, request.user.organizationId!, false))
  }

  const scope = await getClientAccessScope(request.user.sub)
  const board = await getBoardById(id, request.user.organizationId!, true, scope.clientIds)
  const allowedDepartmentIds = scope.departmentIdsByClient.get(board.clientId) ?? new Set<string>()

  return reply.send({
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      tasks: column.tasks.filter((task) => allowedDepartmentIds.has(task.departmentId)),
    })),
  })
})
```

- [ ] **Step 5: Update `boards.service.test.ts` / `boards.routes.test.ts`**

For every test that logs in `CLIENT` and expects a board list/detail, apply the Task 1 Step 9 login transformation. Add two new tests:

- `GET /boards` as a `ClientUser` with access to two companies returns boards from both.
- `GET /boards/:id` as a `ClientUser` with access to `clientA`/`deptFiscal` only: a board of `clientA` with one task in `deptFiscal` and one in `deptPessoal` comes back with only the `deptFiscal` task in its columns.

- [ ] **Step 6: Run suite, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
git add apps/api/src/modules/boards
git commit -m "feat(client-users): boards support multi-company clients and per-department task filtering"
```

---

## Task 5: Portal routes — requests, profile, clients list; `clients.service.ts` client-users transaction + search

**Files:**
- Modify: `apps/api/src/modules/portal/portal.routes.ts`
- Modify: `apps/api/src/modules/portal/portal.service.ts`
- Modify: `apps/api/src/modules/requests/requests.schema.ts` (nothing to change here — service already takes `clientId` as a param; only the route needs it explicitly now)
- Modify: `apps/api/src/modules/clients/clients.schema.ts`, `clients.service.ts`, `clients.routes.ts`
- Modify their `.test.ts` counterparts
- Create: `apps/api/src/modules/portal/portal.routes.test.ts` additions for the new `GET /portal/clients` route (if the file doesn't already cover it)

**Interfaces:**
- Consumes: `getClientAccessScope` from Task 1.
- Produces: `GET /portal/clients` (new) — consumed by the frontend portal company selector in Task 8. `POST/PATCH /clients` body gains `clientUsers[]` — consumed by the frontend `Clients.tsx` rework in Task 7. `GET /clients/search-users?q=` (new) — consumed by the same.

- [ ] **Step 1: `portal.service.ts` — profile via `ClientUser`**

```ts
export async function getClientProfile(clientUserId: string) {
  const clientUser = await prisma.clientUser.findUnique({
    where: { id: clientUserId },
    select: { id: true, name: true, email: true, phone: true },
  })
  if (!clientUser) throw new AppError(404, 'Usuário não encontrado')
  return clientUser
}

export async function updateClientProfile(clientUserId: string, data: UpdateProfileBody) {
  const updateData: { phone?: string; passwordHash?: string } = {}
  if (data.phone !== undefined) updateData.phone = data.phone
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10)

  return prisma.clientUser.update({
    where: { id: clientUserId },
    data: updateData,
    select: { id: true, name: true, email: true, phone: true },
  })
}
```

Update `portal.schema.ts`'s `updateProfileSchema`: rename `whatsapp` to `phone` (matches `ClientUser.phone`, not `Client.whatsapp` — the company's WhatsApp stays org-managed only, per spec).

- [ ] **Step 2: `portal.service.ts` — `getTaskHistory` gains department check**

```ts
export async function getTaskHistory(taskId: string, organizationId: string, clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId, clientId: { in: scope.clientIds } } } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task || !task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId)) {
    throw new AppError(404, 'Tarefa não encontrada')
  }

  return prisma.taskHistory.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
}
```

Add the import.

- [ ] **Step 3: `portal.service.ts` — new `listAccessibleClients`**

```ts
export async function listAccessibleClients(clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  if (scope.clientIds.length === 0) return []
  return prisma.client.findMany({
    where: { id: { in: scope.clientIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}
```

- [ ] **Step 4: `portal.routes.ts` — wire everything**

```ts
app.get('/clients', async (request, reply) => {
  return reply.send(await listAccessibleClients(request.user.sub))
})
```

`POST /portal/requests` and `GET /portal/requests` gain an explicit `clientId`:

```ts
app.post('/requests', { preHandler: [checkSubscription] }, async (request, reply) => {
  const result = createRequestSchema.safeParse(request.body)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  const scope = await getClientAccessScope(request.user.sub)
  if (!scope.clientIds.includes(result.data.clientId)) throw new AppError(403, 'Acesso negado')
  return reply.status(201).send(
    await createRequest(request.user.organizationId!, result.data.clientId, result.data),
  )
})

app.get('/requests', async (request, reply) => {
  const { clientId } = request.query as { clientId?: string }
  if (!clientId) throw new AppError(400, 'clientId é obrigatório')
  const scope = await getClientAccessScope(request.user.sub)
  if (!scope.clientIds.includes(clientId)) throw new AppError(403, 'Acesso negado')
  return reply.send(await listRequestsForClient(request.user.organizationId!, clientId))
})
```

`requests.schema.ts`'s `createRequestSchema` gains `clientId: z.string().cuid()` (required).

`GET /requests/:id`, `PATCH /requests/:id/cancel`, `POST /requests/:id/attachments` keep passing `request.user.sub` **but** that's now a `clientUserId`, and `requests.service.ts`'s `getRequestOrThrow`/`cancelRequest` compare `clientId` directly against it — same broken-assumption pattern as everywhere else. Fix at the route layer by resolving via the request's own stored `clientId` instead: fetch the request first (org-scoped, no client filter), then verify `scope.clientIds.includes(request.clientId)`:

```ts
app.get('/requests/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const scope = await getClientAccessScope(request.user.sub)
  const found = await getRequestById(id, request.user.organizationId!)
  if (!scope.clientIds.includes(found.clientId)) throw new AppError(404, 'Solicitação não encontrada')
  return reply.send(found)
})

app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
  const { id } = request.params as { id: string }
  const scope = await getClientAccessScope(request.user.sub)
  const found = await getRequestById(id, request.user.organizationId!)
  if (!scope.clientIds.includes(found.clientId)) throw new AppError(404, 'Solicitação não encontrada')
  return reply.send(await cancelRequest(id, request.user.organizationId!, found.clientId))
})
```

`requests.service.ts`'s `getRequestById(id, organizationId, clientId?)` already supports being called *without* a `clientId` (org-side callers already do this) — calling it with just `(id, organizationId)` here returns the request regardless of owner, which is fine because the route immediately checks `scope.clientIds.includes(found.clientId)` right after and 404s if it doesn't match (never trust the DB row alone once a client-scoped caller is involved).

`POST /requests/:id/attachments` — same pattern: resolve via `getRequestById` first, check scope, then call `createRequestAttachment(requestId, organizationId, found.clientId, ...)`.

`GET /portal/tasks/:taskId/documents` and `POST /portal/tasks/:taskId/documents/requests/:reqId/upload` keep passing `request.user.sub` as before — `task-documents.service.ts` already resolves it correctly per Task 3.

- [ ] **Step 5: `clients.schema.ts` — `clientUsers` on create/update**

```ts
const clientUserLinkSchema = z.union([
  z.object({
    existingId: z.string().cuid(),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
  z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
])

export const createClientSchema = z.object({
  // ...campos existentes (name, clientType, cnpj, cpf, whatsapp, phone, notes, addressFields)
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário'),
})

export const updateClientSchema = z.object({
  // ...campos existentes, todos opcionais
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário').optional(),
})
```

- [ ] **Step 6: `clients.service.ts` — transactional `createClient`/`updateClient`**

```ts
async function upsertClientUserLinks(
  tx: Prisma.TransactionClient, clientId: string, organizationId: string,
  links: CreateClientBody['clientUsers'],
) {
  for (const link of links) {
    let clientUserId: string
    if ('existingId' in link) {
      const existing = await tx.clientUser.findFirst({ where: { id: link.existingId, organizationId } })
      if (!existing) throw new AppError(404, 'Usuário de cliente não encontrado')
      clientUserId = existing.id
    } else {
      const dup = await tx.clientUser.findFirst({ where: { email: link.email, organizationId } })
      if (dup) throw new AppError(409, `E-mail ${link.email} já cadastrado nesta organização`)
      const created = await tx.clientUser.create({
        data: { name: link.name, email: link.email, passwordHash: await hashPassword(link.password), organizationId },
      })
      clientUserId = created.id
    }

    const departments = await tx.department.findMany({ where: { id: { in: link.departmentIds }, organizationId } })
    if (departments.length !== link.departmentIds.length) throw new AppError(404, 'Departamento não encontrado')

    for (const departmentId of link.departmentIds) {
      await tx.clientUserAccess.upsert({
        where: { clientUserId_clientId_departmentId: { clientUserId, clientId, departmentId } },
        update: {},
        create: { clientUserId, clientId, departmentId },
      })
    }
  }
}

export async function createClient(organizationId: string, data: CreateClientBody) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: data.name, clientType: data.clientType ?? 'PJ', cnpj: data.cnpj, cpf: data.cpf,
        whatsapp: data.whatsapp, phone: data.phone, notes: data.notes,
        cep: data.cep, estado: data.estado, cidade: data.cidade, bairro: data.bairro,
        logradouro: data.logradouro, numero: data.numero, complemento: data.complemento,
        organizationId,
      },
    })

    await upsertClientUserLinks(tx, client.id, organizationId, data.clientUsers)

    return tx.client.findUniqueOrThrow({ where: { id: client.id }, select: SELECT })
  })
}
```

`updateClient` gets the same `upsertClientUserLinks` call, guarded by `if (data.clientUsers)`, wrapped in `prisma.$transaction` alongside the existing `client.update` call. **Does not** remove existing access rows on update (`clientUsers` here is additive-only — removing a user's access to a client is done from the `ClientUser` edit screen from Task 2/6, not from the client form, matching the spec's UI split).

Import `Prisma` type and `hashPassword` at the top of the file.

- [ ] **Step 7: `clients.service.ts` — `searchClientUsers`**

```ts
export async function searchClientUsers(organizationId: string, q: string) {
  return prisma.clientUser.findMany({
    where: {
      organizationId, isActive: true,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: 20,
  })
}
```

- [ ] **Step 8: `clients.routes.ts` — new search endpoint**

```ts
app.get('/search-users', {
  preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
}, async (request, reply) => {
  const { q } = request.query as { q?: string }
  return reply.send(await searchClientUsers(request.user.organizationId!, q ?? ''))
})
```

Register this **before** any `/:id`-shaped route in the same file (same reasoning as the earlier `lookup-cnpj` route from the CNPJ-lookup feature this session already shipped).

- [ ] **Step 9: Update tests**

- `portal.routes.test.ts`: every `CLIENT`-role test needs the Task 1 Step 9 login transformation, plus new coverage: `GET /portal/clients` returns exactly the companies the `ClientUser` has access to; `POST /portal/requests` without `clientId` gets 400; with a `clientId` outside scope gets 403; `GET /portal/requests?clientId=` outside scope gets 403.
- `clients.service.test.ts`: `createClient` now requires `clientUsers` — every existing call site in this file needs a `clientUsers: [{ name, email, password, departmentIds: [department.id] }]` entry (create a `department` via `createTestDepartment` in each test's setup where missing). Add a dedicated test: `createClient` throws when `clientUsers` links an `existingId` from another org (404), and a test that `createClient` reuses an existing `ClientUser` via `existingId` without creating a duplicate.
- `clients.routes.test.ts`: `POST /clients` without `clientUsers` gets 400 (Zod `.min(1)`).

- [ ] **Step 10: Run suite, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
git add apps/api/src/modules/portal apps/api/src/modules/clients apps/api/src/modules/requests
git commit -m "feat(client-users): portal requests/profile/clients-list scoped by access; client form accepts clientUsers"
```

---

## Task 6: `Task.departmentId` required end-to-end (backend Zod + frontend)

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts` (only if `departmentId` optionality is referenced in a way that needs a type tightening — read the file first)
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`
- Modify: any other task-creation UI (grep `createTaskSchema`-shaped POST bodies in `apps/web/src` — e.g. `Board.tsx`'s "new task" flow if it exists as a separate form from the drawer)
- Modify: `apps/api/src/modules/tasks/tasks.routes.test.ts`, `tasks.service.test.ts` if either asserts creating a task without `departmentId` succeeds

- [ ] **Step 1: `tasks.schema.ts`**

```ts
export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  departmentId: z.string().cuid(),
})
```

(`updateTaskSchema`'s `departmentId: z.string().cuid().nullable().optional()` **stays nullable** — the DB column is NOT NULL, but the update schema being nullable-optional is what lets the frontend send `{ departmentId: undefined }` to mean "don't change it"; a genuine attempt to null it out at the DB level will fail with a Prisma error, which is the correct hard-stop behavior, not something to special-case in Zod.)

- [ ] **Step 2: Read `tasks.service.ts`'s `createTask`, confirm no `.optional()`-shaped logic needs adjusting**

`assertDepartmentBelongsToOrg` is already called with `if (data.departmentId)` — since `departmentId` is now always present after Zod validation, this `if` is dead code but harmless; leave it (removing it is a style nit outside this plan's scope, not correctness-bearing).

- [ ] **Step 3: `TaskDrawer.tsx` — remove "Sem departamento"**

Find the department `<select>` (used for editing an existing task's department, `canEdit` branch) — this stays optional-looking in the UI only for existing tasks that predate this change... but there are none (confirmed no null-department tasks exist). Remove the `<option value="">Sem departamento</option>` line so every task's department select always has a real value chosen. Read the current file to confirm the exact JSX before editing (department select block, `TaskDrawer.tsx`).

- [ ] **Step 4: Find and fix any standalone "create task" form**

```bash
grep -rln "createTaskSchema\|POST.*'/boards/.*columns.*tasks'\|api.post(\`/columns" apps/web/src
```

If task creation happens through a modal/inline-add rather than exclusively through editing an existing task in `TaskDrawer`, that create form needs a required department `<select>` too (no empty option, `disabled` submit until chosen) — read whichever file the grep surfaces before editing it.

- [ ] **Step 5: Update backend tests, run suite, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/api/src/modules/tasks apps/web/src/components/shared/TaskDrawer.tsx <any other file from Step 4>
git commit -m "feat(client-users): departmentId required on task creation (backend + UI)"
```

---

## Task 7: Frontend — `/app/settings/client-users` (list + form)

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/pages/app/settings/ClientUsers.tsx`
- Create: `apps/web/src/pages/app/settings/ClientUserForm.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /client-users` from Task 2.
- Produces: nothing consumed by later tasks (Task 8's client-search autocomplete hits `/clients/search-users`, not this screen).

- [ ] **Step 1: `types/index.ts` — add `ClientUser`**

```ts
export interface ClientUserAccessItem {
  id: string
  clientId: string
  departmentId: string
  client: { id: string; name: string }
  department: { id: string; name: string }
}

export interface ClientUser {
  id: string
  name: string
  email: string
  phone: string | null
  isActive: boolean
  createdAt: string
  accesses: ClientUserAccessItem[]
}
```

- [ ] **Step 2: `ClientUsers.tsx` (list page)**

Mirror `apps/web/src/pages/app/settings/RecurringTemplates.tsx`'s list structure exactly (`Card` rows, `Plus`/`Pencil`/`Trash2` icons, `Link` to `new`/`:id/edit`, `deleteMutation` calling `DELETE /client-users/:id`, empty-state block). Show each row's name, e-mail, and a comma-joined list of `${access.client.name} (${access.department.name})` under it (truncated if long), plus an "Inativo" badge when `!isActive` (same `bg-neutral-bg text-muted-foreground` pill already used in `RecurringTemplates.tsx`).

```tsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import type { ClientUser } from '@/types'

export default function ClientUsers() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: clientUsers = [], isLoading } = useQuery<ClientUser[]>({
    queryKey: ['client-users'],
    queryFn: () => api.get('/client-users').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/client-users/${id}`),
    onSuccess: () => {
      toast.success('Usuário desativado')
      qc.invalidateQueries({ queryKey: ['client-users'] })
    },
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Usuários de Cliente</h1>
        <Button onClick={() => navigate('/app/settings/client-users/new')} className="gap-2">
          <Plus size={16} />
          Novo usuário
        </Button>
      </div>

      {clientUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <UserCog size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum usuário de cliente cadastrado</p>
          <p className="text-xs mt-1">Cadastre quem, do lado do cliente, vai acessar o portal e quais departamentos pode ver.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clientUsers.map((u) => (
            <Card key={u.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{u.name}</span>
                  {!u.isActive && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {u.accesses.map((a) => `${a.client.name} (${a.department.name})`).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Link to={`/app/settings/client-users/${u.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </Link>
                <button
                  onClick={() => { if (window.confirm(`Desativar "${u.name}"?`)) deleteMutation.mutate(u.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `ClientUserForm.tsx` (full page, follows `RecurringTemplateForm.tsx`'s pattern)**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClientUser, Client, Department } from '@/types'

interface AccessRow { clientId: string; departmentId: string }

interface FormState {
  name: string
  email: string
  password: string
  phone: string
  isActive: boolean
  accesses: AccessRow[]
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', phone: '', isActive: true, accesses: [] }

export default function ClientUserForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [draftClientId, setDraftClientId] = useState('')
  const [draftDepartmentId, setDraftDepartmentId] = useState('')

  const { data: clientUser, isLoading } = useQuery<ClientUser>({
    queryKey: ['client-user', id],
    queryFn: () => api.get(`/client-users/${id}`).then((r) => r.data),
    enabled: isEditing,
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  useEffect(() => {
    if (!clientUser) return
    setForm({
      name: clientUser.name, email: clientUser.email, password: '', phone: clientUser.phone ?? '',
      isActive: clientUser.isActive,
      accesses: clientUser.accesses.map((a) => ({ clientId: a.clientId, departmentId: a.departmentId })),
    })
  }, [clientUser])

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name, email: form.email, phone: form.phone || undefined, isActive: form.isActive,
        accesses: form.accesses,
        ...(form.password ? { password: form.password } : {}),
      }
      return isEditing
        ? api.patch(`/client-users/${id}`, payload).then((r) => r.data)
        : api.post('/client-users', { ...payload, password: form.password }).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Usuário atualizado' : 'Usuário criado')
      qc.invalidateQueries({ queryKey: ['client-users'] })
      navigate('/app/settings/client-users')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar usuário')
    },
  })

  function addAccessRow() {
    if (!draftClientId || !draftDepartmentId) return
    if (form.accesses.some((a) => a.clientId === draftClientId && a.departmentId === draftDepartmentId)) return
    setForm((f) => ({ ...f, accesses: [...f.accesses, { clientId: draftClientId, departmentId: draftDepartmentId }] }))
    setDraftClientId('')
    setDraftDepartmentId('')
  }

  function clientName(id: string) { return clients.find((c) => c.id === id)?.name ?? id }
  function departmentName(id: string) { return departments.find((d) => d.id === id)?.name ?? id }

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/app/settings/client-users" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">{isEditing ? 'Editar usuário' : 'Novo usuário'}</h1>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cu-name">Nome</Label>
            <Input id="cu-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-email">E-mail</Label>
            <Input id="cu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-password">{isEditing ? 'Nova senha (deixe em branco pra manter)' : 'Senha'}</Label>
            <Input id="cu-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!isEditing} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cu-phone">Telefone</Label>
            <Input id="cu-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(82) 99999-9999" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Ativo
        </label>

        <div className="pt-2 border-t border-border space-y-2">
          <Label>Clientes e departamentos com acesso</Label>
          <div className="flex gap-2">
            <select value={draftClientId} onChange={(e) => setDraftClientId(e.target.value)} className="h-9 flex-1 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
              <option value="">Cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={draftDepartmentId} onChange={(e) => setDraftDepartmentId(e.target.value)} className="h-9 flex-1 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
              <option value="">Departamento</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={addAccessRow} disabled={!draftClientId || !draftDepartmentId}>Adicionar</Button>
          </div>

          {form.accesses.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum vínculo adicionado ainda.</p>
          ) : (
            <ul className="space-y-1">
              {form.accesses.map((a, i) => (
                <li key={`${a.clientId}-${a.departmentId}`} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                  <span>{clientName(a.clientId)} — {departmentName(a.departmentId)}</span>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, accesses: f.accesses.filter((_, idx) => idx !== i) }))} className="text-muted-foreground hover:text-danger-text">
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/client-users')}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending || !form.name || !form.email || (!isEditing && !form.password) || form.accesses.length === 0}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: `router.tsx` — three routes**

```tsx
import ClientUsers from '@/pages/app/settings/ClientUsers'
import ClientUserForm from '@/pages/app/settings/ClientUserForm'
```

```tsx
{
  path: 'settings/client-users',
  element: <ProtectedRoute allowedRoles={MANAGER_ROLES}><ClientUsers /></ProtectedRoute>,
},
{
  path: 'settings/client-users/new',
  element: <ProtectedRoute allowedRoles={MANAGER_ROLES}><ClientUserForm /></ProtectedRoute>,
},
{
  path: 'settings/client-users/:id/edit',
  element: <ProtectedRoute allowedRoles={MANAGER_ROLES}><ClientUserForm /></ProtectedRoute>,
},
```

(`MANAGER_ROLES` — matches the backend's `requireRole('ORG_ADMIN', 'ORG_MANAGER')` on `/client-users`; reuse the constant already defined at the top of `router.tsx`, not `ADMIN_ROLES`.)

- [ ] **Step 5: `AppLayout.tsx` — sidebar entry**

```tsx
{MANAGER_ROLES_OR_WHATEVER_THE_FILE_USES.includes(role) && (
  <SidebarLink to="/app/settings/client-users" icon={<UserCog size={16} />} label="Usuários de Cliente" onClick={handleNavClick} />
)}
```

Read the file's actual role-check variable name (it uses `ADMIN_ROLES` for most `Configurações` entries — confirm whether the backend's `ORG_MANAGER` allowance means this link should show for managers too, matching the route's `MANAGER_ROLES`; if `AppLayout.tsx` doesn't already have a manager-level constant, add `role !== 'ORG_MEMBER'` inline rather than introducing a new constant for one link). Add the `UserCog` import from `lucide-react` alongside the file's other icon imports. Place it right after the `Departamentos` link, before `Tarefas Recorrentes`.

- [ ] **Step 6: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/types/index.ts apps/web/src/pages/app/settings/ClientUsers.tsx apps/web/src/pages/app/settings/ClientUserForm.tsx apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(client-users): dedicated screen to manage portal users and their client+department access"
```

---

## Task 8: Frontend — `Clients.tsx` "Usuários com acesso" section

**Files:**
- Modify: `apps/web/src/pages/app/Clients.tsx`

**Interfaces:**
- Consumes: `GET /clients/search-users?q=` (Task 5), `POST/PATCH /clients` with `clientUsers[]` (Task 5).

- [ ] **Step 1: Remove `email`/`password` from `CreateForm`/`EditForm` and the JSX that renders them**

`Clients.tsx`'s create-form block currently has explicit `E-mail`/`Senha do portal` inputs before `ClientFields` — these fields, and their `createForm.email`/`createForm.password` state, no longer correspond to anything on `Client` (that data now lives on `ClientUser`, entered via the new section below). Remove those two `Input` blocks and their state fields from `CreateForm`; `EditForm` never had `password` and its `email` field goes too. Also drop `email`/`password` from the `createMutation`/`updateMutation` request bodies (they were already flagged for removal by the backend's Task 1 Zod schema change — Zod silently stripped them before, now the fields don't exist in state to send in the first place).

- [ ] **Step 2: Add a `ClientUsersSection` component, used by both create and edit forms**

Insert after the `Endereço` section, before the submit buttons, in both the create block and the edit `Dialog`.

```tsx
interface ClientUserLink {
  existingId?: string
  name?: string
  email?: string
  password?: string
  departmentIds: string[]
}

interface ClientUserSearchResult { id: string; name: string; email: string }

function ClientUsersSection({ links, onChange }: {
  links: ClientUserLink[]
  onChange: (links: ClientUserLink[]) => void
}) {
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [draft, setDraft] = useState({ name: '', email: '', password: '' })
  const [draftDepartmentIds, setDraftDepartmentIds] = useState<string[]>([])

  const { data: results = [] } = useQuery<ClientUserSearchResult[]>({
    queryKey: ['client-user-search', search],
    queryFn: () => api.get('/clients/search-users', { params: { q: search } }).then((r) => r.data),
    enabled: search.trim().length >= 2,
  })

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  function toggleDept(id: string) {
    setDraftDepartmentIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  function addExisting(u: ClientUserSearchResult) {
    if (draftDepartmentIds.length === 0) return
    onChange([...links, { existingId: u.id, departmentIds: draftDepartmentIds }])
    setSearch(''); setDraftDepartmentIds([])
  }

  function addNew() {
    if (!draft.name || !draft.email || !draft.password || draftDepartmentIds.length === 0) return
    onChange([...links, { name: draft.name, email: draft.email, password: draft.password, departmentIds: draftDepartmentIds }])
    setDraft({ name: '', email: '', password: '' }); setDraftDepartmentIds([])
  }

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <Label>Usuários com acesso *</Label>

      <div className="flex rounded-md border border-border overflow-hidden w-fit">
        {(['search', 'create'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn('px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}>
            {m === 'search' ? 'Buscar existente' : 'Criar novo'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => (
          <button key={d.id} type="button" onClick={() => toggleDept(d.id)}
            className={cn('text-xs px-2 py-1 rounded-full border', draftDepartmentIds.includes(d.id) ? 'bg-[#185FA5] text-white border-[#185FA5]' : 'bg-surface text-muted-foreground border-border')}>
            {d.name}
          </button>
        ))}
      </div>

      {mode === 'search' ? (
        <div className="space-y-1.5">
          <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.length > 0 && (
            <ul className="border border-border rounded-md divide-y divide-border">
              {results.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{u.name} — {u.email}</span>
                  <Button type="button" size="sm" variant="outline" disabled={draftDepartmentIds.length === 0} onClick={() => addExisting(u)}>Adicionar</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input placeholder="Nome" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input placeholder="E-mail" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <Input placeholder="Senha" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
          <Button type="button" variant="outline" className="sm:col-span-3" disabled={draftDepartmentIds.length === 0} onClick={addNew}>Adicionar usuário</Button>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-xs text-danger-text">Adicione pelo menos um usuário.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l, i) => (
            <li key={i} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
              <span>{l.name ?? 'Usuário existente'} — {l.departmentIds.length} depto(s)</span>
              <button type="button" onClick={() => onChange(links.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger-text">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire `clientUsers` state into `CreateForm`/`EditForm`**

Add `clientUsers: ClientUserLink[]` to both form types and `EMPTY_CREATE` (`clientUsers: []`). Render `<ClientUsersSection links={createForm.clientUsers} onChange={(v) => setCreateForm({ ...createForm, clientUsers: v })} />` after `ClientFields` in the create block, and the equivalent for `editForm` inside the edit `Dialog`. Disable both submit buttons when `clientUsers.length === 0` (add `|| createForm.clientUsers.length === 0` / `|| editForm.clientUsers.length === 0` to the existing `disabled` expressions).

- [ ] **Step 3: Send `clientUsers` in both mutations**

Add `clientUsers: createForm.clientUsers` / `clientUsers: editForm.clientUsers` to the `createMutation`/`updateMutation` request bodies (Task 5's `createClientSchema`/`updateClientSchema` expect exactly this shape).

- [ ] **Step 4: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/pages/app/Clients.tsx
git commit -m "feat(client-users): client form requires linking at least one portal user"
```

---

## Task 9: Portal company selector, profile page, requests wiring; docs

**Files:**
- Modify: `apps/web/src/pages/portal/Layout.tsx`
- Modify: `apps/web/src/pages/portal/Profile.tsx`
- Modify: `apps/web/src/pages/portal/Requests.tsx`
- Modify: `docs/SPEC.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1: `PortalLayout.tsx` — fetch accessible companies, expose a selector when there's more than one**

```tsx
const { data: accessibleClients = [] } = useQuery<{ id: string; name: string }[]>({
  queryKey: ['portal-clients'],
  queryFn: () => api.get('/portal/clients').then((r) => r.data),
})

const [selectedClientId, setSelectedClientId] = useState<string>(() => localStorage.getItem('portal-client-id') ?? '')

useEffect(() => {
  if (accessibleClients.length === 0) return
  if (!accessibleClients.some((c) => c.id === selectedClientId)) {
    setSelectedClientId(accessibleClients[0].id)
  }
}, [accessibleClients])

useEffect(() => {
  if (selectedClientId) localStorage.setItem('portal-client-id', selectedClientId)
}, [selectedClientId])
```

Expose `selectedClientId`/`setSelectedClientId` through the existing portal context/outlet mechanism (read `PortalLayout.tsx` first to see whether it already has a context provider or passes props via `<Outlet context={...} />` — match whatever pattern is already there; if none exists, add a minimal `React.createContext` and a `usePortalClient()` hook next to the layout). Render the selector — a simple `<select>`, same visual weight as other header controls — **only when `accessibleClients.length > 1`**; render nothing extra when there's exactly one (the common case stays exactly as simple as today).

- [ ] **Step 2: `portal/Requests.tsx` — pass `clientId` explicitly**

```tsx
const { clientId } = usePortalClient() // from Step 1's context

const { data: requests = [] } = useQuery<ClientRequest[]>({
  queryKey: ['portal-requests', clientId],
  queryFn: () => api.get('/portal/requests', { params: { clientId } }).then((r) => r.data),
  enabled: !!clientId,
})
```

`createMutation`'s POST body gains `clientId` (from the same context). Read the current file (already read earlier this session) and apply this precisely — don't restructure anything else about the form.

- [ ] **Step 3: `portal/Profile.tsx` — rename `whatsapp` to `phone`**

The profile form's `whatsapp` field (label, state key, `PATCH /portal/profile` body key) becomes `phone`, matching Task 5's `updateProfileSchema` change. Read the current file (already read earlier this session) and apply the rename precisely across the `Profile` interface, `form` state, and the input's `Label`/`id`/`onChange`.

- [ ] **Step 4: Docs — `SPEC.md`**

Add a "Usuários de Cliente" section documenting `GET/POST/PATCH/DELETE /client-users`, `GET /clients/search-users`, `GET /portal/clients`, and the `clientUsers[]` shape now required by `POST/PATCH /clients`. Update the existing `/clients` entry's example body to drop `email`/`password` and add `clientUsers`. Update the `/portal/requests` entries to note the now-required `clientId`. Update `/portal/profile` to show `phone` instead of `whatsapp`.

- [ ] **Step 5: Docs — `TASKS.md`**

Add an entry under whichever phase covers portal/client management noting: "Usuários de cliente com acesso por departamento — `ClientUser`/`ClientUserAccess`, login do portal desacoplado de `Client`, `Task.departmentId` obrigatório" with today's date, mirroring how earlier features (departments, recurring tasks) were logged there.

- [ ] **Step 6: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/pages/portal docs/SPEC.md docs/TASKS.md
git commit -m "feat(client-users): portal company selector, profile phone field, docs"
```

---

## Final Verification (after Task 9)

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
```

Manual smoke test (dev servers): create a client with two `ClientUser` links (one new, one existing) covering different departments; log into the portal as each; confirm each only sees boards/tasks for their assigned department(s); confirm the company selector appears only for a `ClientUser` with more than one company; submit a portal request and confirm it lands against the right company; confirm an org-side comment on a department-restricted task notifies email to every `ClientUser` with access to that client (check `NotificationLog` rows, one per recipient).
