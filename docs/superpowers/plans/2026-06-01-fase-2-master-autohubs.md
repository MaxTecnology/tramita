# Fase 2 — Master AutoHubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o painel do Master AutoHubs — CRUD de planos, gestão de escritórios e dashboard de receita, com painel React em `/master` protegido por autenticação MASTER-only.

**Architecture:** Backend em três módulos (`plans/`, `organizations/`, `master/revenue`) todos agrupados sob o plugin `masterRoutes` que aplica `verifyJWT + requireRole('MASTER')` a todo o prefixo `/master`. Frontend usa react-router-dom v7 + axios + TanStack Query; sem Tailwind/shadcn (vem na Fase 6) — UI funcional com HTML semântico.

**Tech Stack:** Fastify v5, Prisma v6, Zod, Vitest (backend); React 19, react-router-dom v7, axios, @tanstack/react-query v5 (frontend).

---

## File Map

```
apps/api/src/modules/
  plans/
    plans.schema.ts
    plans.types.ts
    plans.service.ts
    plans.routes.ts
    plans.service.test.ts
    plans.routes.test.ts
  organizations/
    organizations.schema.ts
    organizations.types.ts
    organizations.service.ts
    organizations.routes.ts           ← master view: list/get/patch
    organizations.routes.test.ts
  master/
    revenue.service.ts
    revenue.routes.ts
    revenue.service.test.ts
    index.ts                          ← masterRoutes plugin, agrupa tudo
apps/api/src/test/helpers.ts          ← adiciona createMasterUser()
apps/api/src/server.ts                ← registra masterRoutes em /master

apps/web/src/
  lib/
    api.ts                            ← axios instance (baseURL + auth header)
    queryClient.ts                    ← TanStack Query client
  hooks/
    useAuth.ts                        ← lê JWT do localStorage, expõe user/role
  pages/
    Login.tsx                         ← form + redirect por role
    master/
      Layout.tsx                      ← sidebar + guard MASTER-only
      Dashboard.tsx                   ← MRR, orgs ativas, churn
      Plans.tsx                       ← tabela + criar/editar/deletar plano
      Organizations.tsx               ← tabela + modal suspend/reactivate/change-plan
  router.tsx                          ← todas as rotas da aplicação
  App.tsx                             ← <QueryClientProvider> + <RouterProvider>
  main.tsx                            ← createRoot (já existe, atualizar)
docs/http/doc.http                    ← adiciona rotas /master/*
```

---

## Task 1: Atualizar helpers de teste

**Files:**
- Modify: `apps/api/src/test/helpers.ts`

- [ ] **Step 1: Adicionar `createMasterUser` e `getAuthHeader` ao helpers.ts**

```typescript
// apps/api/src/test/helpers.ts
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import type { LoginResponse } from '@/modules/auth/auth.types'

export async function createTestPlan(overrides?: Partial<{ name: string; maxClients: number }>) {
  return prisma.plan.create({
    data: {
      name: overrides?.name ?? 'Test Plan',
      maxClients: overrides?.maxClients ?? 50,
      priceMonthly: 197.0,
      features: { pdf: true, sse: true, attachments: true },
      isActive: true,
    },
  })
}

export async function createTestOrg(planId: string, overrides?: Partial<{ slug: string }>) {
  const unique = Date.now()
  return prisma.organization.create({
    data: {
      name: 'Test Org',
      slug: overrides?.slug ?? `test-org-${unique}`,
      email: `org-${unique}@test.com`,
      planId,
      subscriptionStatus: 'ACTIVE',
    },
  })
}

export async function createTestUser(
  organizationId: string,
  overrides?: Partial<{
    role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
    email: string
    password: string
  }>,
) {
  const password = overrides?.password ?? 'Test@1234'
  return prisma.user.create({
    data: {
      name: 'Test User',
      email: overrides?.email ?? `user-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: overrides?.role ?? 'ORG_ADMIN',
      organizationId,
    },
  })
}

export async function createTestClient(organizationId: string) {
  return prisma.client.create({
    data: {
      name: 'Test Client',
      email: `client-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash('Client@1234', 10),
      organizationId,
    },
  })
}

// Returns { user, password } so the test can login
export async function createMasterUser() {
  const plan = await createTestPlan({ name: 'Master Plan' })
  const org = await prisma.organization.create({
    data: {
      name: 'AutoHubs Test',
      slug: `autohubs-${Date.now()}`,
      email: `autohubs-${Date.now()}@test.com`,
      planId: plan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })
  const password = 'Master@Test123'
  const user = await prisma.user.create({
    data: {
      name: 'Master Test',
      email: `master-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'MASTER',
      organizationId: org.id,
    },
  })
  return { user, password }
}

// Convenience: login and return Bearer header string
export async function getAuthHeader(email: string, password: string): Promise<string> {
  const res = await loginAs(email, password)
  return `Bearer ${res.accessToken}`
}

export async function loginAs(email: string, password: string): Promise<LoginResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  })
  return JSON.parse(response.body) as LoginResponse
}
```

- [ ] **Step 2: Verificar que os testes existentes ainda passam**

```bash
cd apps/api && pnpm test
```

Expected: 22 passed (2 files).

---

## Task 2: Módulo `plans` — TDD service

**Files:**
- Create: `apps/api/src/modules/plans/plans.types.ts`
- Create: `apps/api/src/modules/plans/plans.schema.ts`
- Create: `apps/api/src/modules/plans/plans.service.test.ts`
- Create: `apps/api/src/modules/plans/plans.service.ts`

- [ ] **Step 1: Criar plans.types.ts**

```typescript
// apps/api/src/modules/plans/plans.types.ts
export interface PlanFeatures {
  pdf: boolean
  sse: boolean
  attachments: boolean
  [key: string]: boolean
}

export interface PlanData {
  name: string
  maxClients: number
  priceMonthly: number
  features: PlanFeatures
}
```

- [ ] **Step 2: Criar plans.schema.ts**

```typescript
// apps/api/src/modules/plans/plans.schema.ts
import { z } from 'zod'

export const createPlanSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  maxClients: z.number().int().positive('Limite de clientes deve ser positivo'),
  priceMonthly: z.number().positive('Preço deve ser positivo'),
  features: z.record(z.boolean()).default({}),
})

export const updatePlanSchema = createPlanSchema.partial()

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
```

- [ ] **Step 3: Escrever plans.service.test.ts**

```typescript
// apps/api/src/modules/plans/plans.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  listPlans,
  createPlan,
  updatePlan,
  softDeletePlan,
} from '@/modules/plans/plans.service'
import { AppError } from '@/errors/AppError'

describe('listPlans', () => {
  it('returns empty array when no plans exist', async () => {
    const result = await listPlans()
    expect(result).toEqual([])
  })

  it('returns plans ordered by priceMonthly ascending', async () => {
    await prisma.plan.createMany({
      data: [
        { name: 'Enterprise', maxClients: 999, priceMonthly: 497, features: {} },
        { name: 'Starter', maxClients: 15, priceMonthly: 97, features: {} },
        { name: 'Pro', maxClients: 50, priceMonthly: 197, features: {} },
      ],
    })
    const result = await listPlans()
    expect(result.map((p) => p.name)).toEqual(['Starter', 'Pro', 'Enterprise'])
  })

  it('includes inactive plans', async () => {
    await prisma.plan.create({
      data: { name: 'Old Plan', maxClients: 10, priceMonthly: 50, features: {}, isActive: false },
    })
    const result = await listPlans()
    expect(result).toHaveLength(1)
    expect(result[0].isActive).toBe(false)
  })
})

describe('createPlan', () => {
  it('creates and returns the new plan', async () => {
    const plan = await createPlan({
      name: 'Pro',
      maxClients: 50,
      priceMonthly: 197,
      features: { pdf: true, sse: false, attachments: true },
    })
    expect(plan.id).toBeTruthy()
    expect(plan.name).toBe('Pro')
    expect(plan.maxClients).toBe(50)
    expect(plan.isActive).toBe(true)
  })
})

describe('updatePlan', () => {
  it('updates only provided fields', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Old', maxClients: 10, priceMonthly: 50, features: {} },
    })
    const updated = await updatePlan(plan.id, { name: 'New', maxClients: 20 })
    expect(updated.name).toBe('New')
    expect(updated.maxClients).toBe(20)
    expect(Number(updated.priceMonthly)).toBe(50) // unchanged
  })

  it('throws 404 for nonexistent plan', async () => {
    await expect(updatePlan('nonexistent-id', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('softDeletePlan', () => {
  it('sets isActive to false', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Doomed', maxClients: 10, priceMonthly: 50, features: {} },
    })
    await softDeletePlan(plan.id)
    const found = await prisma.plan.findUnique({ where: { id: plan.id } })
    expect(found?.isActive).toBe(false)
  })

  it('throws 404 for nonexistent plan', async () => {
    await expect(softDeletePlan('nonexistent-id')).rejects.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Step 4: Rodar testes — verificar FAIL**

```bash
cd apps/api && pnpm test src/modules/plans/plans.service.test.ts
```

Expected: FAIL — "Cannot find module '@/modules/plans/plans.service'"

- [ ] **Step 5: Criar plans.service.ts**

```typescript
// apps/api/src/modules/plans/plans.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreatePlanInput, UpdatePlanInput } from '@/modules/plans/plans.schema'

export async function listPlans() {
  return prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } })
}

export async function createPlan(data: CreatePlanInput) {
  return prisma.plan.create({ data })
}

export async function updatePlan(id: string, data: UpdatePlanInput) {
  const plan = await prisma.plan.findUnique({ where: { id } })
  if (!plan) throw new AppError(404, 'Plano não encontrado')
  return prisma.plan.update({ where: { id }, data })
}

export async function softDeletePlan(id: string) {
  const plan = await prisma.plan.findUnique({ where: { id } })
  if (!plan) throw new AppError(404, 'Plano não encontrado')
  return prisma.plan.update({ where: { id }, data: { isActive: false } })
}
```

- [ ] **Step 6: Rodar testes — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/plans/plans.service.test.ts
```

Expected: 8 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/plans/ apps/api/src/test/helpers.ts
git commit -m "feat: plans service TDD — CRUD + soft delete"
```

---

## Task 3: Módulo `plans` — TDD routes

**Files:**
- Create: `apps/api/src/modules/plans/plans.routes.ts`
- Create: `apps/api/src/modules/plans/plans.routes.test.ts`

- [ ] **Step 1: Criar stub plans.routes.ts (necessário para server.ts compilar)**

```typescript
// apps/api/src/modules/plans/plans.routes.ts
import type { FastifyInstance } from 'fastify'

export async function planRoutes(_app: FastifyInstance) {}
```

- [ ] **Step 2: Escrever plans.routes.test.ts**

```typescript
// apps/api/src/modules/plans/plans.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import {
  createMasterUser,
  getAuthHeader,
  createTestPlan,
  createTestOrg,
  createTestUser,
} from '@/test/helpers'

let masterHeader: string

beforeEach(async () => {
  const { user, password } = await createMasterUser()
  masterHeader = await getAuthHeader(user.email, password)
})

describe('GET /master/plans', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/master/plans' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const orgAdmin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(orgAdmin.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/master/plans',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns plan list for MASTER', async () => {
    await createTestPlan({ name: 'Starter' })
    const res = await app.inject({
      method: 'GET',
      url: '/master/plans',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /master/plans', () => {
  it('returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/master/plans',
      headers: { authorization: masterHeader },
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates plan and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/master/plans',
      headers: { authorization: masterHeader },
      payload: {
        name: 'Pro',
        maxClients: 50,
        priceMonthly: 197,
        features: { pdf: true, sse: true, attachments: true },
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.name).toBe('Pro')
    expect(body.isActive).toBe(true)
  })
})

describe('PATCH /master/plans/:id', () => {
  it('updates plan name and returns 200', async () => {
    const plan = await createTestPlan({ name: 'Old' })
    const res = await app.inject({
      method: 'PATCH',
      url: `/master/plans/${plan.id}`,
      headers: { authorization: masterHeader },
      payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('New')
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/master/plans/nonexistent',
      headers: { authorization: masterHeader },
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /master/plans/:id', () => {
  it('soft-deletes plan (isActive=false) and returns 200', async () => {
    const plan = await createTestPlan()
    const res = await app.inject({
      method: 'DELETE',
      url: `/master/plans/${plan.id}`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).isActive).toBe(false)
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/master/plans/nonexistent',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: Registrar masterRoutes em server.ts (stub) e rodar — verificar FAIL**

Adicionar ao `apps/api/src/server.ts`:
```typescript
import { masterRoutes } from '@/modules/master/index'
// ...
app.register(masterRoutes, { prefix: '/master' })
```

Criar stub `apps/api/src/modules/master/index.ts`:
```typescript
import type { FastifyInstance } from 'fastify'

export async function masterRoutes(_app: FastifyInstance) {}
```

```bash
cd apps/api && pnpm test src/modules/plans/plans.routes.test.ts
```

Expected: FAIL — GET /master/plans returns 404 (routes not registered yet).

- [ ] **Step 4: Implementar plans.routes.ts**

```typescript
// apps/api/src/modules/plans/plans.routes.ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { listPlans, createPlan, updatePlan, softDeletePlan } from '@/modules/plans/plans.service'
import { createPlanSchema, updatePlanSchema } from '@/modules/plans/plans.schema'

export async function planRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send(await listPlans())
  })

  app.post('/', async (request, reply) => {
    const result = createPlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createPlan(result.data))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updatePlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updatePlan(id, result.data))
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await softDeletePlan(id))
  })
}
```

- [ ] **Step 5: Implementar master/index.ts**

```typescript
// apps/api/src/modules/master/index.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { planRoutes } from '@/modules/plans/plans.routes'
import { masterOrgRoutes } from '@/modules/organizations/organizations.routes'
import { revenueRoutes } from '@/modules/master/revenue.routes'

export async function masterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('MASTER'))

  app.register(planRoutes, { prefix: '/plans' })
  app.register(masterOrgRoutes, { prefix: '/organizations' })
  app.register(revenueRoutes)
}
```

Criar stub `apps/api/src/modules/organizations/organizations.routes.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
export async function masterOrgRoutes(_app: FastifyInstance) {}
```

Criar stub `apps/api/src/modules/master/revenue.routes.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
export async function revenueRoutes(_app: FastifyInstance) {}
```

Atualizar `apps/api/src/server.ts`:
```typescript
import Fastify from 'fastify'
import corsPlugin from '@/plugins/cors'
import rateLimitPlugin from '@/plugins/rate-limit'
import { authRoutes } from '@/modules/auth/auth.routes'
import { masterRoutes } from '@/modules/master/index'
import { AppError } from '@/errors/AppError'

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  app.register(corsPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(authRoutes, { prefix: '/auth' })
  app.register(masterRoutes, { prefix: '/master' })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    if (error.statusCode) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    app.log.error(error)
    return reply.status(500).send({ message: 'Erro interno do servidor' })
  })

  return app
}
```

- [ ] **Step 6: Rodar testes — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/plans/plans.routes.test.ts
```

Expected: 8 passed.

- [ ] **Step 7: Rodar suite completa — verificar nenhuma regressão**

```bash
cd apps/api && pnpm test
```

Expected: 30 passed (3 files).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/plans/ apps/api/src/modules/master/ \
        apps/api/src/modules/organizations/ apps/api/src/server.ts
git commit -m "feat: plans routes TDD — GET/POST/PATCH/DELETE /master/plans"
```

---

## Task 4: Módulo `organizations` — TDD routes (master view)

**Files:**
- Create: `apps/api/src/modules/organizations/organizations.types.ts`
- Create: `apps/api/src/modules/organizations/organizations.schema.ts`
- Create: `apps/api/src/modules/organizations/organizations.service.ts`
- Modify: `apps/api/src/modules/organizations/organizations.routes.ts`
- Create: `apps/api/src/modules/organizations/organizations.routes.test.ts`

- [ ] **Step 1: Criar organizations.types.ts**

```typescript
// apps/api/src/modules/organizations/organizations.types.ts
export interface OrgListItem {
  id: string
  name: string
  slug: string
  email: string
  subscriptionStatus: string
  planName: string
  clientsCount: number
  usersCount: number
  createdAt: Date
}

export interface OrgDetail extends OrgListItem {
  cnpj: string | null
  phone: string | null
  planId: string
  gracePeriodEndsAt: Date | null
  trialEndsAt: Date | null
  subscriptionHistory: Array<{
    id: string
    event: string
    amount: number | null
    createdAt: Date
  }>
}

export interface UpdateOrgInput {
  planId?: string
  subscriptionStatus?: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'GRACE_PERIOD' | 'TRIAL'
}
```

- [ ] **Step 2: Criar organizations.schema.ts**

```typescript
// apps/api/src/modules/organizations/organizations.schema.ts
import { z } from 'zod'

export const updateOrgSchema = z.object({
  planId: z.string().optional(),
  subscriptionStatus: z
    .enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'GRACE_PERIOD', 'TRIAL'])
    .optional(),
})

export type UpdateOrgBody = z.infer<typeof updateOrgSchema>
```

- [ ] **Step 3: Escrever organizations.routes.test.ts**

```typescript
// apps/api/src/modules/organizations/organizations.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import {
  createMasterUser,
  getAuthHeader,
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
} from '@/test/helpers'

let masterHeader: string

beforeEach(async () => {
  const { user, password } = await createMasterUser()
  masterHeader = await getAuthHeader(user.email, password)
})

describe('GET /master/organizations', () => {
  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns list with subscription status and counts', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestUser(org.id)
    await createTestClient(org.id)

    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{
      id: string
      subscriptionStatus: string
      clientsCount: number
      usersCount: number
    }>
    // The master org created by createMasterUser is also in the list
    const testOrg = body.find((o) => o.id === org.id)
    expect(testOrg).toBeDefined()
    expect(testOrg?.subscriptionStatus).toBe('ACTIVE')
    expect(testOrg?.clientsCount).toBe(1)
    expect(testOrg?.usersCount).toBe(1)
  })
})

describe('GET /master/organizations/:id', () => {
  it('returns org details with subscription history', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const res = await app.inject({
      method: 'GET',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe(org.id)
    expect(Array.isArray(body.subscriptionHistory)).toBe(true)
  })

  it('returns 404 for nonexistent org', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations/nonexistent',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /master/organizations/:id', () => {
  it('can suspend org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'SUSPENDED' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).subscriptionStatus).toBe('SUSPENDED')
  })

  it('can reactivate org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.organization.update({
      where: { id: org.id },
      data: { subscriptionStatus: 'SUSPENDED' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'ACTIVE' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).subscriptionStatus).toBe('ACTIVE')
  })

  it('can change plan', async () => {
    const oldPlan = await createTestPlan({ name: 'Starter' })
    const newPlan = await createTestPlan({ name: 'Pro', maxClients: 100 })
    const org = await createTestOrg(oldPlan.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { planId: newPlan.id },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).planId).toBe(newPlan.id)
  })

  it('returns 404 for nonexistent org', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/master/organizations/nonexistent',
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'ACTIVE' },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 4: Rodar tests — verificar FAIL**

```bash
cd apps/api && pnpm test src/modules/organizations/organizations.routes.test.ts
```

Expected: FAIL — 404 (stub routes não implementam nada).

- [ ] **Step 5: Criar organizations.service.ts**

```typescript
// apps/api/src/modules/organizations/organizations.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { UpdateOrgBody } from '@/modules/organizations/organizations.schema'

export async function listOrganizations() {
  const orgs = await prisma.organization.findMany({
    include: {
      plan: { select: { name: true } },
      _count: { select: { clients: { where: { isActive: true } }, users: { where: { isActive: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return orgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    email: org.email,
    subscriptionStatus: org.subscriptionStatus,
    planId: org.planId,
    planName: org.plan.name,
    clientsCount: org._count.clients,
    usersCount: org._count.users,
    createdAt: org.createdAt,
  }))
}

export async function getOrganization(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      plan: { select: { name: true } },
      _count: { select: { clients: { where: { isActive: true } }, users: { where: { isActive: true } } } },
      subscriptionHistory: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    cnpj: org.cnpj,
    email: org.email,
    phone: org.phone,
    subscriptionStatus: org.subscriptionStatus,
    planId: org.planId,
    planName: org.plan.name,
    clientsCount: org._count.clients,
    usersCount: org._count.users,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    trialEndsAt: org.trialEndsAt,
    subscriptionHistory: org.subscriptionHistory,
    createdAt: org.createdAt,
  }
}

export async function updateOrganization(id: string, data: UpdateOrgBody) {
  const org = await prisma.organization.findUnique({ where: { id } })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return prisma.organization.update({ where: { id }, data })
}
```

- [ ] **Step 6: Implementar organizations.routes.ts**

```typescript
// apps/api/src/modules/organizations/organizations.routes.ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import {
  listOrganizations,
  getOrganization,
  updateOrganization,
} from '@/modules/organizations/organizations.service'
import { updateOrgSchema } from '@/modules/organizations/organizations.schema'

export async function masterOrgRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send(await listOrganizations())
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getOrganization(id))
  })

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateOrgSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateOrganization(id, result.data))
  })
}
```

- [ ] **Step 7: Rodar testes — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/organizations/organizations.routes.test.ts
```

Expected: 7 passed.

- [ ] **Step 8: Suite completa**

```bash
cd apps/api && pnpm test
```

Expected: 37 passed (4 files).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/organizations/
git commit -m "feat: organizations routes TDD — GET/PATCH /master/organizations (master view)"
```

---

## Task 5: Revenue endpoint TDD

**Files:**
- Create: `apps/api/src/modules/master/revenue.service.ts`
- Create: `apps/api/src/modules/master/revenue.service.test.ts`
- Modify: `apps/api/src/modules/master/revenue.routes.ts`

- [ ] **Step 1: Escrever revenue.service.test.ts**

```typescript
// apps/api/src/modules/master/revenue.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getRevenue } from '@/modules/master/revenue.service'

describe('getRevenue', () => {
  it('returns zeros when no orgs exist', async () => {
    const result = await getRevenue()
    expect(result.mrr).toBe(0)
    expect(result.totalOrgsAtivas).toBe(0)
    expect(result.churn).toBe(0)
  })

  it('calculates MRR from active orgs plan prices', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Pro', maxClients: 50, priceMonthly: 197, features: {} },
    })
    await prisma.organization.createMany({
      data: [
        { name: 'Org1', slug: 'org1', email: 'o1@test.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
        { name: 'Org2', slug: 'org2', email: 'o2@test.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
        { name: 'Org3', slug: 'org3', email: 'o3@test.com', planId: plan.id, subscriptionStatus: 'SUSPENDED' },
      ],
    })
    const result = await getRevenue()
    // Only 2 ACTIVE orgs × R$197 = R$394
    expect(result.mrr).toBe(394)
    expect(result.totalOrgsAtivas).toBe(2)
  })

  it('counts cancelled orgs as churn', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Starter', maxClients: 15, priceMonthly: 97, features: {} },
    })
    await prisma.organization.createMany({
      data: [
        { name: 'Gone1', slug: 'gone1', email: 'g1@test.com', planId: plan.id, subscriptionStatus: 'CANCELLED' },
        { name: 'Gone2', slug: 'gone2', email: 'g2@test.com', planId: plan.id, subscriptionStatus: 'CANCELLED' },
        { name: 'Active', slug: 'active', email: 'a@test.com', planId: plan.id, subscriptionStatus: 'ACTIVE' },
      ],
    })
    const result = await getRevenue()
    expect(result.churn).toBe(2)
    expect(result.totalOrgsAtivas).toBe(1)
    expect(result.mrr).toBe(97)
  })
})
```

- [ ] **Step 2: Rodar testes — verificar FAIL**

```bash
cd apps/api && pnpm test src/modules/master/revenue.service.test.ts
```

Expected: FAIL — "Cannot find module '@/modules/master/revenue.service'"

- [ ] **Step 3: Criar revenue.service.ts**

```typescript
// apps/api/src/modules/master/revenue.service.ts
import { prisma } from '@/lib/prisma'

export async function getRevenue() {
  const activeOrgs = await prisma.organization.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    include: { plan: { select: { priceMonthly: true } } },
  })

  const mrr = activeOrgs.reduce((sum, org) => sum + Number(org.plan.priceMonthly), 0)

  const churn = await prisma.organization.count({
    where: { subscriptionStatus: 'CANCELLED' },
  })

  return {
    mrr,
    totalOrgsAtivas: activeOrgs.length,
    churn,
  }
}
```

- [ ] **Step 4: Rodar testes — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/master/revenue.service.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Implementar revenue.routes.ts**

```typescript
// apps/api/src/modules/master/revenue.routes.ts
import type { FastifyInstance } from 'fastify'
import { getRevenue } from '@/modules/master/revenue.service'

export async function revenueRoutes(app: FastifyInstance) {
  app.get('/revenue', async (_req, reply) => {
    return reply.send(await getRevenue())
  })
}
```

- [ ] **Step 6: Suite completa**

```bash
cd apps/api && pnpm test
```

Expected: 40 passed (5 files).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/master/
git commit -m "feat: revenue endpoint TDD — GET /master/revenue (MRR, totalOrgsAtivas, churn)"
```

---

## Task 6: Atualizar doc.http com rotas /master

**Files:**
- Modify: `docs/http/doc.http`

- [ ] **Step 1: Adicionar seção Master ao doc.http**

Append ao final do arquivo `docs/http/doc.http`:

```http
# ─────────────────────────────────────────────
# MASTER — Planos
# Todas as rotas /master/* exigem role MASTER
# ─────────────────────────────────────────────

### Lista todos os planos (ativos e inativos)
GET {{baseUrl}}/master/plans
Authorization: {{accessToken}}

###

### Cria novo plano
POST {{baseUrl}}/master/plans
Content-Type: application/json
Authorization: {{accessToken}}

{
  "name": "Pro",
  "maxClients": 50,
  "priceMonthly": 197.00,
  "features": { "pdf": true, "sse": true, "attachments": true }
}

###

### Atualiza plano (campos parciais)
PATCH {{baseUrl}}/master/plans/{{planId}}
Content-Type: application/json
Authorization: {{accessToken}}

{
  "maxClients": 60,
  "priceMonthly": 217.00
}

###

### Soft-delete de plano (isActive: false)
DELETE {{baseUrl}}/master/plans/{{planId}}
Authorization: {{accessToken}}


# ─────────────────────────────────────────────
# MASTER — Escritórios
# ─────────────────────────────────────────────

### Lista escritórios com status de assinatura e contadores
GET {{baseUrl}}/master/organizations
Authorization: {{accessToken}}

###

### Detalhes do escritório + histórico de pagamentos
GET {{baseUrl}}/master/organizations/{{orgId}}
Authorization: {{accessToken}}

###

### Altera plano do escritório
PATCH {{baseUrl}}/master/organizations/{{orgId}}
Content-Type: application/json
Authorization: {{accessToken}}

{
  "planId": "{{planId}}"
}

###

### Suspende escritório
PATCH {{baseUrl}}/master/organizations/{{orgId}}
Content-Type: application/json
Authorization: {{accessToken}}

{
  "subscriptionStatus": "SUSPENDED"
}

###

### Reativa escritório suspenso
PATCH {{baseUrl}}/master/organizations/{{orgId}}
Content-Type: application/json
Authorization: {{accessToken}}

{
  "subscriptionStatus": "ACTIVE"
}


# ─────────────────────────────────────────────
# MASTER — Revenue Dashboard
# ─────────────────────────────────────────────

### Retorna MRR, total de orgs ativas e churn
# mrr: soma de plan.priceMonthly de todas as orgs ACTIVE
# totalOrgsAtivas: contagem de orgs com subscriptionStatus = ACTIVE
# churn: contagem de orgs com subscriptionStatus = CANCELLED
GET {{baseUrl}}/master/revenue
Authorization: {{accessToken}}
```

Adicionar variáveis no topo do arquivo (após as existentes):
```
@planId = plan-id-aqui
@orgId = org-id-aqui
```

- [ ] **Step 2: Commit**

```bash
git add docs/http/doc.http
git commit -m "docs: adiciona rotas /master/* ao doc.http"
```

---

## Task 7: Web — instalar dependências e configurar router

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/queryClient.ts`
- Create: `apps/web/src/hooks/useAuth.ts`
- Create: `apps/web/src/router.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Instalar dependências web**

```bash
cd apps/web && pnpm add react-router-dom @tanstack/react-query axios
```

Expected: packages added.

- [ ] **Step 2: Criar src/lib/api.ts**

```typescript
// apps/web/src/lib/api.ts
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
            { refreshToken },
          )
          localStorage.setItem('accessToken', data.accessToken)
          error.config.headers.Authorization = `Bearer ${data.accessToken}`
          return api.request(error.config)
        } catch {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          localStorage.removeItem('user')
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  },
)
```

- [ ] **Step 3: Criar src/lib/queryClient.ts**

```typescript
// apps/web/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})
```

- [ ] **Step 4: Criar src/hooks/useAuth.ts**

```typescript
// apps/web/src/hooks/useAuth.ts
import { useMemo } from 'react'

interface StoredUser {
  id: string
  name: string
  role: string
  organizationId: string | null
}

export function useAuth() {
  const user = useMemo<StoredUser | null>(() => {
    try {
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw) as StoredUser) : null
    } catch {
      return null
    }
  }, [])

  const isAuthenticated = !!localStorage.getItem('accessToken')

  function logout() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
  }

  return { user, isAuthenticated, logout }
}
```

- [ ] **Step 5: Criar src/router.tsx**

```typescript
// apps/web/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import Login from '@/pages/Login'
import MasterLayout from '@/pages/master/Layout'
import MasterDashboard from '@/pages/master/Dashboard'
import MasterPlans from '@/pages/master/Plans'
import MasterOrganizations from '@/pages/master/Organizations'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/master',
    element: <MasterLayout />,
    children: [
      { index: true, element: <Navigate to="/master/dashboard" replace /> },
      { path: 'dashboard', element: <MasterDashboard /> },
      { path: 'plans', element: <MasterPlans /> },
      { path: 'organizations', element: <MasterOrganizations /> },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
])
```

- [ ] **Step 6: Atualizar src/App.tsx**

```typescript
// apps/web/src/App.tsx
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

- [ ] **Step 7: Atualizar src/main.tsx**

```typescript
// apps/web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Adicionar alias @/ ao vite.config.ts**

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
```

Atualizar `apps/web/tsconfig.json` para incluir o path alias:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "outDir": "dist",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: web — react-router-dom + axios + react-query setup"
```

---

## Task 8: Login page + Master layout

**Files:**
- Create: `apps/web/src/pages/Login.tsx`
- Create: `apps/web/src/pages/master/Layout.tsx`
- Create: `apps/web/src/pages/master/Dashboard.tsx` (stub)
- Create: `apps/web/src/pages/master/Plans.tsx` (stub)
- Create: `apps/web/src/pages/master/Organizations.tsx` (stub)

- [ ] **Step 1: Criar src/pages/Login.tsx**

```typescript
// apps/web/src/pages/Login.tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('accessToken', data.accessToken)
      localStorage.setItem('refreshToken', data.refreshToken)
      localStorage.setItem('user', JSON.stringify(data.user))

      const role: string = data.user.role
      if (role === 'MASTER') navigate('/master/dashboard')
      else if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER') navigate('/app/dashboard')
      else if (role === 'ORG_MEMBER') navigate('/app/board')
      else navigate('/portal/board')
    } catch {
      setError('E-mail ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Tramita</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginBottom: 12 }}
          />
        </div>
        <div>
          <label>Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginBottom: 12 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Criar src/pages/master/Layout.tsx (com guard MASTER-only)**

```typescript
// apps/web/src/pages/master/Layout.tsx
import { Outlet, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useEffect } from 'react'

export default function MasterLayout() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'MASTER') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  if (!isAuthenticated || user?.role !== 'MASTER') return null

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 220, background: '#1a1a2e', color: '#fff', padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>AutoHubs Master</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li><Link to="/master/dashboard" style={{ color: '#fff' }}>Dashboard</Link></li>
          <li style={{ marginTop: 12 }}><Link to="/master/plans" style={{ color: '#fff' }}>Planos</Link></li>
          <li style={{ marginTop: 12 }}><Link to="/master/organizations" style={{ color: '#fff' }}>Escritórios</Link></li>
        </ul>
        <button onClick={handleLogout} style={{ marginTop: 'auto', display: 'block' }}>
          Sair
        </button>
      </nav>
      <main style={{ flex: 1, padding: 32 }}>
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Criar src/pages/master/Dashboard.tsx**

```typescript
// apps/web/src/pages/master/Dashboard.tsx
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Revenue {
  mrr: number
  totalOrgsAtivas: number
  churn: number
}

export default function MasterDashboard() {
  const { data, isLoading, error } = useQuery<Revenue>({
    queryKey: ['master', 'revenue'],
    queryFn: () => api.get('/master/revenue').then((r) => r.data),
  })

  if (isLoading) return <p>Carregando...</p>
  if (error) return <p>Erro ao carregar dados.</p>

  return (
    <div>
      <h1>Dashboard</h1>
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ border: '1px solid #ccc', padding: 24, borderRadius: 8 }}>
          <h3>MRR</h3>
          <p style={{ fontSize: 32, fontWeight: 'bold' }}>
            R$ {data?.mrr.toFixed(2)}
          </p>
        </div>
        <div style={{ border: '1px solid #ccc', padding: 24, borderRadius: 8 }}>
          <h3>Orgs Ativas</h3>
          <p style={{ fontSize: 32, fontWeight: 'bold' }}>{data?.totalOrgsAtivas}</p>
        </div>
        <div style={{ border: '1px solid #ccc', padding: 24, borderRadius: 8 }}>
          <h3>Churn</h3>
          <p style={{ fontSize: 32, fontWeight: 'bold' }}>{data?.churn}</p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Criar src/pages/master/Plans.tsx**

```typescript
// apps/web/src/pages/master/Plans.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Plan {
  id: string
  name: string
  maxClients: number
  priceMonthly: number
  isActive: boolean
}

export default function MasterPlans() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', maxClients: 0, priceMonthly: 0 })
  const [editId, setEditId] = useState<string | null>(null)

  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ['master', 'plans'],
    queryFn: () => api.get('/master/plans').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/master/plans', { ...data, features: { pdf: true, sse: true, attachments: true } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['master', 'plans'] }); setForm({ name: '', maxClients: 0, priceMonthly: 0 }) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof form> }) =>
      api.patch(`/master/plans/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['master', 'plans'] }); setEditId(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/master/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['master', 'plans'] }),
  })

  if (isLoading) return <p>Carregando planos...</p>

  return (
    <div>
      <h1>Planos</h1>

      <form
        onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form) }}
        style={{ marginBottom: 24, display: 'flex', gap: 8 }}
      >
        <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="number" placeholder="Max clientes" value={form.maxClients || ''} onChange={(e) => setForm({ ...form, maxClients: Number(e.target.value) })} required />
        <input type="number" placeholder="Preço/mês (R$)" value={form.priceMonthly || ''} onChange={(e) => setForm({ ...form, priceMonthly: Number(e.target.value) })} required />
        <button type="submit">Criar Plano</button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Nome</th><th>Max Clientes</th><th>Preço/mês</th><th>Ativo</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>
                {editId === plan.id ? (
                  <input defaultValue={plan.name} id={`name-${plan.id}`} />
                ) : plan.name}
              </td>
              <td>{plan.maxClients}</td>
              <td>R$ {Number(plan.priceMonthly).toFixed(2)}</td>
              <td>{plan.isActive ? 'Sim' : 'Não'}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                {editId === plan.id ? (
                  <button onClick={() => {
                    const name = (document.getElementById(`name-${plan.id}`) as HTMLInputElement).value
                    updateMutation.mutate({ id: plan.id, data: { name } })
                  }}>Salvar</button>
                ) : (
                  <button onClick={() => setEditId(plan.id)}>Editar</button>
                )}
                {plan.isActive && (
                  <button onClick={() => deleteMutation.mutate(plan.id)} style={{ color: 'red' }}>
                    Desativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Criar src/pages/master/Organizations.tsx**

```typescript
// apps/web/src/pages/master/Organizations.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Org {
  id: string
  name: string
  email: string
  subscriptionStatus: string
  planName: string
  clientsCount: number
  usersCount: number
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  TRIAL: 'Trial',
  GRACE_PERIOD: 'Carência',
  CANCELLED: 'Cancelada',
}

export default function MasterOrganizations() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Org | null>(null)

  const { data: orgs = [], isLoading } = useQuery<Org[]>({
    queryKey: ['master', 'organizations'],
    queryFn: () => api.get('/master/organizations').then((r) => r.data),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) =>
      api.patch(`/master/organizations/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['master', 'organizations'] })
      setSelected(null)
    },
  })

  if (isLoading) return <p>Carregando escritórios...</p>

  return (
    <div>
      <h1>Escritórios</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Nome</th><th>E-mail</th><th>Plano</th><th>Status</th><th>Clientes</th><th>Usuários</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{org.name}</td>
              <td>{org.email}</td>
              <td>{org.planName}</td>
              <td>{STATUS_LABELS[org.subscriptionStatus] ?? org.subscriptionStatus}</td>
              <td>{org.clientsCount}</td>
              <td>{org.usersCount}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                {org.subscriptionStatus !== 'SUSPENDED' && (
                  <button
                    style={{ color: 'orange' }}
                    onClick={() => patchMutation.mutate({ id: org.id, data: { subscriptionStatus: 'SUSPENDED' } })}
                  >
                    Suspender
                  </button>
                )}
                {org.subscriptionStatus === 'SUSPENDED' && (
                  <button
                    style={{ color: 'green' }}
                    onClick={() => patchMutation.mutate({ id: org.id, data: { subscriptionStatus: 'ACTIVE' } })}
                  >
                    Reativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Verificar que o web compila sem erros**

```bash
cd apps/web && pnpm build 2>&1 | tail -10
```

Expected: sem erros de TypeScript, arquivos gerados em `dist/`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat: painel React /master — login + dashboard + planos + escritórios"
```

---

## Task 9: Verificação final da Fase 2

- [ ] **Step 1: Rodar suite completa de testes**

```bash
cd apps/api && pnpm test
```

Expected: 40 passed (5 files).

- [ ] **Step 2: Verificar critério de conclusão da Fase 2**

```bash
# Sobe API
fuser -k 3000/tcp 2>/dev/null
cd apps/api && node --import tsx/esm src/app.ts &
sleep 3

# Login como MASTER
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"master@autohubs.com.br","password":"Master@AutoHubs2025"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Token:', d['accessToken'][:30])"

# Cria plano
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"master@autohubs.com.br","password":"Master@AutoHubs2025"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

curl -s -X POST http://localhost:3000/master/plans \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Teste","maxClients":25,"priceMonthly":150,"features":{}}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Plan created:', d.get('name'), '| id:', d.get('id','N/A')[:8])"

# Lista orgs
curl -s http://localhost:3000/master/organizations \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; orgs=json.load(sys.stdin); print('Orgs:', len(orgs))"

# Revenue
curl -s http://localhost:3000/master/revenue \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))"
```

Expected:
- Token gerado
- Plano criado com nome "Teste"
- Lista de orgs com pelo menos 2 (autohubs + g2a do seed)
- Revenue com mrr, totalOrgsAtivas, churn

- [ ] **Step 3: Atualizar TASKS.md**

Marcar todos os itens da Fase 2 como `[x]`.

- [ ] **Step 4: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Fase 2 como concluída no TASKS.md"
```

---

## Self-Review

### Spec coverage:

| Requisito TASKS.md | Task |
|---|---|
| `plans.service.test.ts` — CRUD de planos, soft delete | Task 2 |
| `plans.routes.test.ts` — acesso bloqueado para role != MASTER | Task 3 |
| `organizations.routes.test.ts` — listagem e gestão pelo Master | Task 4 |
| CRUD de planos (`/master/plans`) | Task 3 |
| Listagem e gestão de escritórios (`/master/organizations`) | Task 4 |
| Dashboard de receita — MRR, total orgs ativas, churn | Task 5 |
| Painel React: `/master` com autenticação MASTER-only | Tasks 7-8 |

Todos os 7 itens cobertos. ✓

### Placeholder scan: nenhum TBD, TODO ou "similar to" encontrado. ✓

### Type consistency:
- `UpdateOrgBody` (schema) → usado em `updateOrganization(id, data: UpdateOrgBody)` ✓
- `CreatePlanInput` (schema) → usado em `createPlan(data: CreatePlanInput)` ✓
- `masterOrgRoutes` exportado de organizations.routes.ts → importado em master/index.ts ✓
- `revenueRoutes` exportado de revenue.routes.ts → importado em master/index.ts ✓
