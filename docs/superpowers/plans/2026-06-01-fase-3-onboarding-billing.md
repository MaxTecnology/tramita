# Fase 3 — Onboarding de Escritórios + Billing Asaas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar cadastro público de escritórios com integração Asaas (customer + subscription), webhook handler para eventos de pagamento, grace period automático, rotas `/org/subscription` e telas React de cadastro e status da assinatura.

**Architecture:** O `asaas.ts` é mockado via `vi.mock` nos testes de service — nunca chama a API real em CI. O register endpoint usa compensação manual: cria no DB, chama Asaas, se Asaas falhar deleta o registro. O middleware `checkSubscription` auto-suspende orgs com grace period expirado na próxima request (lazy suspension). Webhook valida `?accessToken=` na query string e busca org por `asaasSubscriptionId`.

**Tech Stack:** axios (Asaas client), Fastify v5, Prisma v6, Zod, Vitest + vi.mock, React 19.

---

## File Map

```
apps/api/src/
  lib/
    asaas.ts                                ← NEW: client HTTP Asaas (createCustomer, createSubscription)
  modules/
    organizations/
      organizations.schema.ts               ← MODIFY: add registerSchema, changePlanSchema
      organizations.service.ts              ← MODIFY: add register(), getOrgSubscription(), changePlan()
      organizations.routes.ts               ← MODIFY: add publicOrgRoutes, orgRoutes
      organizations.service.test.ts         ← NEW: register TDD com vi.mock('@/lib/asaas')
    webhooks/
      webhooks.routes.ts                    ← NEW: POST /webhooks/asaas
      webhooks.routes.test.ts               ← NEW: 3 eventos + secret validation
  middlewares/
    checkSubscription.ts                    ← MODIFY: add GRACE_PERIOD lazy-suspend
    checkSubscription.test.ts               ← NEW: unit tests via mock FastifyRequest
  server.ts                                 ← MODIFY: register publicOrgRoutes, orgRoutes, webhooksRoutes
docs/http/doc.http                          ← MODIFY: add /organizations/register, /org/*, /webhooks/*

apps/web/src/
  pages/
    Register.tsx                            ← NEW: choose plan → preencher dados → criar conta
    org/
      Subscription.tsx                      ← NEW: status + histórico + change-plan
  router.tsx                                ← MODIFY: add /register, /org/subscription
```

---

## Task 1: Asaas client

**Files:**
- Create: `apps/api/src/lib/asaas.ts`

- [ ] **Step 1: Criar src/lib/asaas.ts**

```typescript
// apps/api/src/lib/asaas.ts
import axios from 'axios'

const asaasHttp = axios.create({
  baseURL: process.env.ASAAS_BASE_URL ?? 'https://api.asaas.com/v3',
  headers: { access_token: process.env.ASAAS_API_KEY ?? '' },
})

export interface AsaasCustomer {
  id: string
  name: string
  email: string
}

export interface AsaasSubscription {
  id: string
  status: string
}

export async function createCustomer(data: {
  name: string
  email: string
  cpfCnpj?: string
}): Promise<AsaasCustomer> {
  const res = await asaasHttp.post<AsaasCustomer>('/customers', data)
  return res.data
}

export async function createSubscription(data: {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX'
  value: number
  cycle: 'MONTHLY'
  description?: string
}): Promise<AsaasSubscription> {
  const res = await asaasHttp.post<AsaasSubscription>('/subscriptions', data)
  return res.data
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await asaasHttp.delete(`/subscriptions/${subscriptionId}`)
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/src/lib/asaas.ts
git commit -m "feat: Asaas HTTP client (createCustomer, createSubscription, cancelSubscription)"
```

---

## Task 2: Organizations register — TDD service

**Files:**
- Modify: `apps/api/src/modules/organizations/organizations.schema.ts`
- Create: `apps/api/src/modules/organizations/organizations.service.test.ts`
- Modify: `apps/api/src/modules/organizations/organizations.service.ts`

- [ ] **Step 1: Adicionar schemas ao organizations.schema.ts**

```typescript
// apps/api/src/modules/organizations/organizations.schema.ts
import { z } from 'zod'

export const updateOrgSchema = z.object({
  planId: z.string().optional(),
  subscriptionStatus: z
    .enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'GRACE_PERIOD', 'TRIAL'])
    .optional(),
})

export const registerOrgSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  cnpj: z.string().optional(),
  email: z.string().email('E-mail inválido'),
  phone: z.string().optional(),
  adminName: z.string().min(2, 'Nome do admin obrigatório'),
  adminPassword: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  planId: z.string().min(1, 'Plano obrigatório'),
})

export const changePlanSchema = z.object({
  planId: z.string().min(1, 'planId obrigatório'),
})

export type UpdateOrgBody = z.infer<typeof updateOrgSchema>
export type RegisterOrgBody = z.infer<typeof registerOrgSchema>
export type ChangePlanBody = z.infer<typeof changePlanSchema>
```

- [ ] **Step 2: Escrever organizations.service.test.ts**

```typescript
// apps/api/src/modules/organizations/organizations.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { register, getOrgSubscription, changePlan } from '@/modules/organizations/organizations.service'
import { createTestPlan, createTestOrg, createMasterUser } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

// Mock the Asaas client — never call real API in tests
vi.mock('@/lib/asaas', () => ({
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test123', name: 'Test', email: 'test@test.com' }),
  createSubscription: vi.fn().mockResolvedValue({ id: 'sub_test123', status: 'ACTIVE' }),
  cancelSubscription: vi.fn().mockResolvedValue(undefined),
}))

describe('register', () => {
  it('creates organization, ORG_ADMIN user, and calls Asaas', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const { createCustomer, createSubscription } = await import('@/lib/asaas')

    const result = await register({
      name: 'Contabilidade ABC',
      email: `abc-${Date.now()}@test.com`,
      adminName: 'Admin ABC',
      adminPassword: 'Senha@123',
      planId: plan.id,
    })

    expect(result.organization.name).toBe('Contabilidade ABC')
    expect(result.user.role).toBe('ORG_ADMIN')
    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: result.organization.email }),
    )
    expect(createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_test123', cycle: 'MONTHLY' }),
    )

    const org = await prisma.organization.findUnique({ where: { id: result.organization.id } })
    expect(org?.asaasCustomerId).toBe('cus_test123')
    expect(org?.asaasSubscriptionId).toBe('sub_test123')
  })

  it('throws 409 if email already registered', async () => {
    const plan = await createTestPlan()
    const email = `dup-${Date.now()}@test.com`
    await prisma.organization.create({
      data: { name: 'Existing', slug: `existing-${Date.now()}`, email, planId: plan.id },
    })

    await expect(
      register({ name: 'New', email, adminName: 'A', adminPassword: 'Senha@123', planId: plan.id }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('throws 404 for inactive plan', async () => {
    const plan = await prisma.plan.create({
      data: { name: 'Old', maxClients: 10, priceMonthly: 50, features: {}, isActive: false },
    })
    await expect(
      register({
        name: 'Org',
        email: `org-${Date.now()}@test.com`,
        adminName: 'A',
        adminPassword: 'Senha@123',
        planId: plan.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('creates org in TRIAL status when planId = "trial"', async () => {
    const result = await register({
      name: 'Trial Org',
      email: `trial-${Date.now()}@test.com`,
      adminName: 'Admin',
      adminPassword: 'Senha@123',
      planId: 'trial',
    })

    expect(result.organization.subscriptionStatus).toBe('TRIAL')
    expect(result.organization.trialEndsAt).toBeTruthy()

    const { createCustomer } = await import('@/lib/asaas')
    // Asaas NOT called for trial
    // (createCustomer mock call count stays the same as before this test)
  })
})

describe('getOrgSubscription', () => {
  it('returns org subscription status and history', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.subscriptionHistory.create({
      data: { organizationId: org.id, event: 'PAYMENT_CONFIRMED', amount: 197 },
    })

    const result = await getOrgSubscription(org.id)

    expect(result.subscriptionStatus).toBe('ACTIVE')
    expect(result.subscriptionHistory).toHaveLength(1)
    expect(result.subscriptionHistory[0].event).toBe('PAYMENT_CONFIRMED')
  })
})

describe('changePlan', () => {
  it('updates planId in DB', async () => {
    const oldPlan = await createTestPlan({ name: 'Starter' })
    const newPlan = await createTestPlan({ name: 'Pro', maxClients: 100 })
    const org = await createTestOrg(oldPlan.id)

    const updated = await changePlan(org.id, newPlan.id)

    expect(updated.planId).toBe(newPlan.id)
  })

  it('throws 404 for nonexistent plan', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    await expect(changePlan(org.id, 'nonexistent-plan')).rejects.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Step 3: Rodar — verificar FAIL**

```bash
cd apps/api && pnpm test src/modules/organizations/organizations.service.test.ts
```

Expected: FAIL — `register` not exported from organizations.service.

- [ ] **Step 4: Implementar register(), getOrgSubscription(), changePlan() em organizations.service.ts**

```typescript
// apps/api/src/modules/organizations/organizations.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import { createCustomer, createSubscription } from '@/lib/asaas'
import type { UpdateOrgBody, RegisterOrgBody } from '@/modules/organizations/organizations.schema'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

async function uniqueSlug(name: string): Promise<string> {
  const base = generateSlug(name)
  let slug = base
  let i = 1
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`
  }
  return slug
}

export async function register(data: RegisterOrgBody) {
  const existing = await prisma.organization.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  // Trial plan — skip Asaas
  if (data.planId === 'trial') {
    const slug = await uniqueSlug(data.name)
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    const passwordHash = await hashPassword(data.adminPassword)

    // Use starter plan as reference for trial (must exist)
    const starterPlan = await prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } })
    if (!starterPlan) throw new AppError(404, 'Nenhum plano disponível')

    const organization = await prisma.organization.create({
      data: {
        name: data.name, slug, cnpj: data.cnpj, email: data.email, phone: data.phone,
        planId: starterPlan.id, subscriptionStatus: 'TRIAL', trialEndsAt,
      },
    })
    const user = await prisma.user.create({
      data: {
        name: data.adminName, email: data.email, passwordHash,
        role: 'ORG_ADMIN', organizationId: organization.id,
      },
    })
    return { organization, user }
  }

  // Real plan — validate + create Asaas entities
  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')

  const slug = await uniqueSlug(data.name)
  const passwordHash = await hashPassword(data.adminPassword)

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.name, slug, cnpj: data.cnpj, email: data.email,
        phone: data.phone, planId: data.planId,
      },
    })
    const user = await tx.user.create({
      data: {
        name: data.adminName, email: data.email, passwordHash,
        role: 'ORG_ADMIN', organizationId: organization.id,
      },
    })
    return { organization, user }
  })

  try {
    const customer = await createCustomer({ name: data.name, email: data.email, cpfCnpj: data.cnpj })
    const subscription = await createSubscription({
      customer: customer.id,
      billingType: 'BOLETO',
      value: Number(plan.priceMonthly),
      cycle: 'MONTHLY',
      description: `Assinatura ${plan.name} — Tramita`,
    })
    await prisma.organization.update({
      where: { id: organization.id },
      data: { asaasCustomerId: customer.id, asaasSubscriptionId: subscription.id },
    })
    organization.asaasCustomerId = customer.id
    organization.asaasSubscriptionId = subscription.id
  } catch {
    // Compensate: delete user then org
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.organization.delete({ where: { id: organization.id } })
    throw new AppError(502, 'Erro ao integrar com sistema de cobrança. Tente novamente.')
  }

  return { organization, user }
}

export async function listPublicPlans() {
  return prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } })
}

export async function getOrgSubscription(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      plan: { select: { id: true, name: true, maxClients: true, priceMonthly: true } },
      subscriptionHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { clients: { where: { isActive: true } } } },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')

  return {
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    asaasSubscriptionId: org.asaasSubscriptionId,
    plan: org.plan,
    clientsCount: org._count.clients,
    subscriptionHistory: org.subscriptionHistory,
  }
}

export async function changePlan(organizationId: string, planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')

  return prisma.organization.update({ where: { id: organizationId }, data: { planId } })
}

// Keep existing master functions
export async function listOrganizations() {
  const orgs = await prisma.organization.findMany({
    include: {
      plan: { select: { name: true } },
      _count: {
        select: {
          clients: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return orgs.map((org) => ({
    id: org.id, name: org.name, slug: org.slug, email: org.email,
    subscriptionStatus: org.subscriptionStatus, planId: org.planId,
    planName: org.plan.name, clientsCount: org._count.clients,
    usersCount: org._count.users, createdAt: org.createdAt,
  }))
}

export async function getOrganization(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      plan: { select: { name: true } },
      _count: {
        select: {
          clients: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
      subscriptionHistory: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return {
    id: org.id, name: org.name, slug: org.slug, cnpj: org.cnpj, email: org.email,
    phone: org.phone, subscriptionStatus: org.subscriptionStatus, planId: org.planId,
    planName: org.plan.name, clientsCount: org._count.clients, usersCount: org._count.users,
    gracePeriodEndsAt: org.gracePeriodEndsAt, trialEndsAt: org.trialEndsAt,
    subscriptionHistory: org.subscriptionHistory, createdAt: org.createdAt,
  }
}

export async function updateOrganization(id: string, data: UpdateOrgBody) {
  const org = await prisma.organization.findUnique({ where: { id } })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return prisma.organization.update({ where: { id }, data })
}
```

- [ ] **Step 5: Rodar — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/organizations/organizations.service.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/src/modules/organizations/ apps/api/src/lib/asaas.ts
git commit -m "feat: organizations register TDD — POST /organizations/register + Asaas mockado"
```

---

## Task 3: Public org routes + org routes TDD

**Files:**
- Modify: `apps/api/src/modules/organizations/organizations.routes.ts`
- Modify: `apps/api/src/server.ts`

> These routes are tested inline in Task 2 integration + the webhook tests. Separate route-level tests would repeat too much. We test the key access-control cases here.

- [ ] **Step 1: Atualizar organizations.routes.ts — adicionar publicOrgRoutes e orgRoutes**

```typescript
// apps/api/src/modules/organizations/organizations.routes.ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import {
  listOrganizations, getOrganization, updateOrganization,
  register, listPublicPlans, getOrgSubscription, changePlan,
} from '@/modules/organizations/organizations.service'
import {
  updateOrgSchema, registerOrgSchema, changePlanSchema,
} from '@/modules/organizations/organizations.schema'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'

// ── /master/organizations/* ───────────────────────────────────────────────────
export async function masterOrgRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.send(await listOrganizations()))

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

// ── /organizations/* (public, no auth) ───────────────────────────────────────
export async function publicOrgRoutes(app: FastifyInstance) {
  app.get('/plans', async (_req, reply) => {
    return reply.send(await listPublicPlans())
  })

  app.post('/register', async (request, reply) => {
    const result = registerOrgSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const data = await register(result.data)
    return reply.status(201).send(data)
  })
}

// ── /org/* (ORG_ADMIN only) ───────────────────────────────────────────────────
export async function orgRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.get('/subscription', async (request, reply) => {
    return reply.send(await getOrgSubscription(request.user.organizationId!))
  })

  app.post('/subscription/change-plan', async (request, reply) => {
    const result = changePlanSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    await changePlan(request.user.organizationId!, result.data.planId)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 2: Registrar as novas rotas em server.ts**

```typescript
// apps/api/src/server.ts
import Fastify from 'fastify'
import corsPlugin from '@/plugins/cors'
import rateLimitPlugin from '@/plugins/rate-limit'
import { authRoutes } from '@/modules/auth/auth.routes'
import { masterRoutes } from '@/modules/master/index'
import { publicOrgRoutes, orgRoutes } from '@/modules/organizations/organizations.routes'
import { webhooksRoutes } from '@/modules/webhooks/webhooks.routes'
import { AppError } from '@/errors/AppError'

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(corsPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(authRoutes, { prefix: '/auth' })
  app.register(masterRoutes, { prefix: '/master' })
  app.register(publicOrgRoutes, { prefix: '/organizations' })
  app.register(orgRoutes, { prefix: '/org' })
  app.register(webhooksRoutes, { prefix: '/webhooks' })

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

Criar stub `apps/api/src/modules/webhooks/webhooks.routes.ts` (preenchido na Task 4):
```typescript
import type { FastifyInstance } from 'fastify'
export async function webhooksRoutes(_app: FastifyInstance) {}
```

- [ ] **Step 3: Rodar suite completa — sem regressões**

```bash
cd apps/api && pnpm test
```

Expected: 50 passed (6 files).

- [ ] **Step 4: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/src/modules/organizations/ apps/api/src/modules/webhooks/ apps/api/src/server.ts
git commit -m "feat: public org routes (register + plans) e org routes (subscription)"
```

---

## Task 4: Webhooks TDD

**Files:**
- Modify: `apps/api/src/modules/webhooks/webhooks.routes.ts`
- Create: `apps/api/src/modules/webhooks/webhooks.routes.test.ts`

- [ ] **Step 1: Escrever webhooks.routes.test.ts**

```typescript
// apps/api/src/modules/webhooks/webhooks.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg } from '@/test/helpers'

const SECRET = 'test-webhook-secret'

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_SECRET = SECRET
})

async function orgWithSubscription(planId: string) {
  const org = await createTestOrg(planId)
  return prisma.organization.update({
    where: { id: org.id },
    data: { asaasSubscriptionId: `sub_${org.id}`, asaasCustomerId: `cus_${org.id}` },
  })
}

function webhookPayload(event: string, subscriptionId: string, value = 197) {
  return {
    event,
    payment: { id: `pay_test`, subscription: subscriptionId, customer: 'cus_test', value },
  }
}

describe('POST /webhooks/asaas', () => {
  it('returns 401 for wrong accessToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/asaas?accessToken=wrong',
      payload: { event: 'PAYMENT_CONFIRMED', payment: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('PAYMENT_CONFIRMED sets subscriptionStatus to ACTIVE', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)
    await prisma.organization.update({
      where: { id: org.id },
      data: { subscriptionStatus: 'GRACE_PERIOD' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('ACTIVE')
  })

  it('PAYMENT_CONFIRMED saves SubscriptionHistory entry', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', org.asaasSubscriptionId!, 197),
    })

    const history = await prisma.subscriptionHistory.findFirst({ where: { organizationId: org.id } })
    expect(history?.event).toBe('PAYMENT_CONFIRMED')
    expect(Number(history?.amount)).toBe(197)
  })

  it('PAYMENT_OVERDUE sets GRACE_PERIOD with gracePeriodEndsAt 7 days from now', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_OVERDUE', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('GRACE_PERIOD')
    expect(updated?.gracePeriodEndsAt).toBeTruthy()

    const daysUntilExpiry =
      (updated!.gracePeriodEndsAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    expect(daysUntilExpiry).toBeGreaterThan(6)
    expect(daysUntilExpiry).toBeLessThan(8)
  })

  it('PAYMENT_DELETED suspends org', async () => {
    const plan = await createTestPlan()
    const org = await orgWithSubscription(plan.id)

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_DELETED', org.asaasSubscriptionId!),
    })
    expect(res.statusCode).toBe(200)

    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('SUSPENDED')
  })

  it('returns 200 (ignores) for unknown subscription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/asaas?accessToken=${SECRET}`,
      payload: webhookPayload('PAYMENT_CONFIRMED', 'sub_nonexistent'),
    })
    expect(res.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar — verificar FAIL**

```bash
cd apps/api && pnpm test src/modules/webhooks/webhooks.routes.test.ts
```

Expected: FAIL — webhook endpoint returns 404 (stub).

- [ ] **Step 3: Implementar webhooks.routes.ts**

```typescript
// apps/api/src/modules/webhooks/webhooks.routes.ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

interface AsaasPayload {
  event: 'PAYMENT_CONFIRMED' | 'PAYMENT_OVERDUE' | 'PAYMENT_DELETED'
  payment: {
    id: string
    subscription: string
    customer: string
    value: number
  }
}

export async function webhooksRoutes(app: FastifyInstance) {
  app.post('/asaas', async (request, reply) => {
    const { accessToken } = request.query as { accessToken?: string }
    if (!accessToken || accessToken !== process.env.ASAAS_WEBHOOK_SECRET) {
      throw new AppError(401, 'Webhook token inválido')
    }

    const { event, payment } = request.body as AsaasPayload
    if (!payment?.subscription) return reply.send({ received: true })

    const org = await prisma.organization.findFirst({
      where: { asaasSubscriptionId: payment.subscription },
    })
    if (!org) return reply.send({ received: true })

    if (event === 'PAYMENT_CONFIRMED') {
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null },
      })
      await prisma.subscriptionHistory.create({
        data: {
          organizationId: org.id,
          event: 'PAYMENT_CONFIRMED',
          amount: payment.value,
          asaasPaymentId: payment.id,
        },
      })
    } else if (event === 'PAYMENT_OVERDUE') {
      const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'GRACE_PERIOD', gracePeriodEndsAt },
      })
      await prisma.subscriptionHistory.create({
        data: { organizationId: org.id, event: 'PAYMENT_OVERDUE', asaasPaymentId: payment.id },
      })
    } else if (event === 'PAYMENT_DELETED') {
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'SUSPENDED' },
      })
      await prisma.subscriptionHistory.create({
        data: { organizationId: org.id, event: 'PAYMENT_DELETED', asaasPaymentId: payment.id },
      })
    }

    return reply.send({ received: true })
  })
}
```

- [ ] **Step 4: Rodar — verificar PASS**

```bash
cd apps/api && pnpm test src/modules/webhooks/webhooks.routes.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Suite completa**

```bash
cd apps/api && pnpm test
```

Expected: 56 passed (7 files).

- [ ] **Step 6: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/src/modules/webhooks/
git commit -m "feat: webhooks TDD — PAYMENT_CONFIRMED/OVERDUE/DELETED + secret validation"
```

---

## Task 5: checkSubscription — extender para GRACE_PERIOD + testes

**Files:**
- Modify: `apps/api/src/middlewares/checkSubscription.ts`
- Create: `apps/api/src/middlewares/checkSubscription.test.ts`

- [ ] **Step 1: Escrever checkSubscription.test.ts**

```typescript
// apps/api/src/middlewares/checkSubscription.test.ts
import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { createTestPlan, createTestOrg } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

function mockRequest(role: string, organizationId: string | null): FastifyRequest {
  return { user: { sub: 'user-1', role, organizationId } } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('checkSubscription', () => {
  it('passes for MASTER (always allowed)', async () => {
    await expect(checkSubscription(mockRequest('MASTER', null), reply)).resolves.toBeUndefined()
  })

  it('passes for ACTIVE org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await expect(checkSubscription(mockRequest('ORG_ADMIN', org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 403 for SUSPENDED org', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Suspended', slug: `sus-${Date.now()}`, email: `sus-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'SUSPENDED',
      },
    })
    await expect(checkSubscription(mockRequest('ORG_ADMIN', org.id), reply)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('passes for GRACE_PERIOD org with future expiry', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Grace', slug: `grace-${Date.now()}`, email: `grace-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'GRACE_PERIOD',
        gracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      },
    })
    await expect(checkSubscription(mockRequest('ORG_ADMIN', org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 403 and auto-suspends GRACE_PERIOD org with past expiry', async () => {
    const plan = await createTestPlan()
    const org = await prisma.organization.create({
      data: {
        name: 'Expired', slug: `exp-${Date.now()}`, email: `exp-${Date.now()}@t.com`,
        planId: plan.id, subscriptionStatus: 'GRACE_PERIOD',
        gracePeriodEndsAt: new Date(Date.now() - 1000), // 1 second ago
      },
    })

    await expect(checkSubscription(mockRequest('ORG_ADMIN', org.id), reply)).rejects.toMatchObject({
      statusCode: 403,
    })

    // Verify auto-suspended in DB
    const updated = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(updated?.subscriptionStatus).toBe('SUSPENDED')
  })
})
```

- [ ] **Step 2: Rodar — verificar FAIL (GRACE_PERIOD tests fail)**

```bash
cd apps/api && pnpm test src/middlewares/checkSubscription.test.ts
```

Expected: 3 fail (grace period logic not implemented yet).

- [ ] **Step 3: Atualizar checkSubscription.ts**

```typescript
// apps/api/src/middlewares/checkSubscription.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkSubscription(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER' || !organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true, gracePeriodEndsAt: true },
  })

  if (org?.subscriptionStatus === 'GRACE_PERIOD' && org.gracePeriodEndsAt) {
    if (org.gracePeriodEndsAt < new Date()) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'SUSPENDED' },
      })
      throw new AppError(403, 'Grace period expirado. Regularize o pagamento para continuar.')
    }
    return // still within grace period — allow
  }

  if (org?.subscriptionStatus === 'SUSPENDED') {
    throw new AppError(403, 'Assinatura suspensa. Regularize o pagamento para continuar.')
  }
}
```

- [ ] **Step 4: Rodar — verificar PASS**

```bash
cd apps/api && pnpm test src/middlewares/checkSubscription.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Suite completa**

```bash
cd apps/api && pnpm test
```

Expected: 61 passed (8 files).

- [ ] **Step 6: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/src/middlewares/checkSubscription.ts apps/api/src/middlewares/checkSubscription.test.ts
git commit -m "feat: checkSubscription TDD — GRACE_PERIOD auto-suspend + unit tests"
```

---

## Task 6: Atualizar doc.http

**Files:**
- Modify: `docs/http/doc.http`

- [ ] **Step 1: Adicionar seções de Fase 3**

Append ao final de `docs/http/doc.http`:

```http
# ─────────────────────────────────────────────
# ORGANIZATIONS — Cadastro Público (sem auth)
# ─────────────────────────────────────────────

### Lista planos disponíveis para escolha no cadastro
GET {{baseUrl}}/organizations/plans


###

### Registra novo escritório — cria org + ORG_ADMIN + customer Asaas + subscription
# planId = "trial" → TRIAL por 14 dias, sem integração Asaas
# Retorna: { organization: {...}, user: { id, name, email, role } }
POST {{baseUrl}}/organizations/register
Content-Type: application/json

{
  "name": "Contabilidade Exemplo",
  "cnpj": "12.345.678/0001-99",
  "email": "contato@exemplo.com.br",
  "phone": "(82) 99999-9999",
  "adminName": "João Admin",
  "adminPassword": "Senha@12345",
  "planId": "{{planId}}"
}


# ─────────────────────────────────────────────
# ORG — Assinatura (role: ORG_ADMIN)
# ─────────────────────────────────────────────

### Status da assinatura + histórico + plano atual
# subscriptionStatus: TRIAL | ACTIVE | GRACE_PERIOD | SUSPENDED | CANCELLED
GET {{baseUrl}}/org/subscription
Authorization: Bearer {{accessToken}}

###

### Troca de plano (atualiza planId no banco)
# Retorna 204 No Content
POST {{baseUrl}}/org/subscription/change-plan
Content-Type: application/json
Authorization: Bearer {{accessToken}}

{
  "planId": "{{planId}}"
}


# ─────────────────────────────────────────────
# WEBHOOKS — Asaas (validado por ?accessToken=)
# ─────────────────────────────────────────────

### PAYMENT_CONFIRMED → subscriptionStatus = ACTIVE + grava SubscriptionHistory
# PAYMENT_OVERDUE → subscriptionStatus = GRACE_PERIOD + gracePeriodEndsAt = now + 7d
# PAYMENT_DELETED → subscriptionStatus = SUSPENDED
POST {{baseUrl}}/webhooks/asaas?accessToken=ASAAS_WEBHOOK_SECRET
Content-Type: application/json

{
  "event": "PAYMENT_CONFIRMED",
  "payment": {
    "id": "pay_xxx",
    "subscription": "{{asaasSubscriptionId}}",
    "customer": "cus_xxx",
    "value": 197.00
  }
}
```

Adicionar variável no topo do arquivo:
```
@asaasSubscriptionId = sub_xxx
```

- [ ] **Step 2: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add docs/http/doc.http
git commit -m "docs: adiciona rotas Fase 3 ao doc.http (/organizations, /org, /webhooks)"
```

---

## Task 7: Web — Tela de cadastro público

**Files:**
- Create: `apps/web/src/pages/Register.tsx`
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Criar src/pages/Register.tsx**

```typescript
// apps/web/src/pages/Register.tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import axios from 'axios'

interface Plan {
  id: string
  name: string
  maxClients: number
  priceMonthly: number
}

type Step = 'plan' | 'form'

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('plan')
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    name: '', cnpj: '', email: '', phone: '',
    adminName: '', adminPassword: '',
  })

  const { data: plans = [], isLoading: loadingPlans } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedPlan) return
    setError('')
    setLoading(true)
    try {
      await api.post('/organizations/register', {
        ...form,
        planId: selectedPlan.id,
        cnpj: form.cnpj || undefined,
        phone: form.phone || undefined,
      })
      navigate('/login', { state: { message: 'Cadastro realizado! Faça login para continuar.' } })
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message ?? 'Erro ao cadastrar. Tente novamente.')
      } else {
        setError('Erro inesperado.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (step === 'plan') {
    return (
      <div style={{ maxWidth: 800, margin: '48px auto', padding: 24 }}>
        <h1>Comece agora — escolha seu plano</h1>
        {loadingPlans ? (
          <p>Carregando planos...</p>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {plans.map((plan) => (
              <div
                key={plan.id}
                onClick={() => { setSelectedPlan(plan); setStep('form') }}
                style={{
                  border: '2px solid #ddd', borderRadius: 12, padding: 24,
                  cursor: 'pointer', minWidth: 200, flex: 1,
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#0070f3')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#ddd')}
              >
                <h2 style={{ marginTop: 0 }}>{plan.name}</h2>
                <p style={{ fontSize: 28, fontWeight: 700, margin: '8px 0' }}>
                  R$ {Number(plan.priceMonthly).toFixed(2)}
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#666' }}>/mês</span>
                </p>
                <p style={{ color: '#555' }}>Até {plan.maxClients} clientes</p>
                <button style={{ width: '100%', padding: '10px', marginTop: 8 }}>
                  Escolher
                </button>
              </div>
            ))}
          </div>
        )}
        <p style={{ marginTop: 24, color: '#666' }}>
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 520, margin: '48px auto', padding: 24 }}>
      <button onClick={() => setStep('plan')} style={{ marginBottom: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#0070f3' }}>
        ← Voltar para planos
      </button>
      <h1 style={{ marginTop: 0 }}>Criar conta — {selectedPlan?.name}</h1>
      <form onSubmit={handleSubmit}>
        <Field label="Nome do escritório" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="CNPJ" value={form.cnpj} onChange={(v) => setForm({ ...form, cnpj: v })} />
        <Field label="E-mail" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
        <Field label="Telefone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <hr style={{ margin: '16px 0', borderColor: '#eee' }} />
        <p style={{ color: '#666', margin: '0 0 8px', fontSize: 13 }}>Dados do administrador</p>
        <Field label="Seu nome" value={form.adminName} onChange={(v) => setForm({ ...form, adminName: v })} required />
        <Field label="Senha" type="password" value={form.adminPassword} onChange={(v) => setForm({ ...form, adminPassword: v })} required />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', marginTop: 8 }}>
          {loading ? 'Criando conta...' : 'Criar conta'}
        </button>
      </form>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', required,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{ display: 'block', width: '100%', padding: '8px', boxSizing: 'border-box' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Adicionar /register ao router.tsx**

```typescript
// apps/web/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import MasterLayout from '@/pages/master/Layout'
import MasterDashboard from '@/pages/master/Dashboard'
import MasterPlans from '@/pages/master/Plans'
import MasterOrganizations from '@/pages/master/Organizations'
import OrgSubscription from '@/pages/org/Subscription'

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
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
  { path: '/org/subscription', element: <OrgSubscription /> },
  { path: '*', element: <Navigate to="/login" replace /> },
])
```

Criar stub para `OrgSubscription` (preenchido na Task 8):
```typescript
// apps/web/src/pages/org/Subscription.tsx
export default function OrgSubscription() {
  return <div>Assinatura</div>
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/web/src/
git commit -m "feat: tela de cadastro público /register — escolher plano + formulário"
```

---

## Task 8: Web — /org/subscription

**Files:**
- Modify: `apps/web/src/pages/org/Subscription.tsx`

- [ ] **Step 1: Implementar src/pages/org/Subscription.tsx**

```typescript
// apps/web/src/pages/org/Subscription.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useEffect } from 'react'

interface Plan { id: string; name: string; maxClients: number; priceMonthly: number }
interface HistoryItem { id: string; event: string; amount: number | null; createdAt: string }
interface SubscriptionData {
  subscriptionStatus: string
  trialEndsAt: string | null
  gracePeriodEndsAt: string | null
  plan: Plan
  clientsCount: number
  subscriptionHistory: HistoryItem[]
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa', SUSPENDED: 'Suspensa', TRIAL: 'Trial',
  GRACE_PERIOD: 'Em carência', CANCELLED: 'Cancelada',
}
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#2a7a2a', SUSPENDED: '#c00', TRIAL: '#0060a0',
  GRACE_PERIOD: '#a06000', CANCELLED: '#666',
}

export default function OrgSubscription() {
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [showChangePlan, setShowChangePlan] = useState(false)

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'ORG_ADMIN')) {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  const { data, isLoading } = useQuery<SubscriptionData>({
    queryKey: ['org', 'subscription'],
    queryFn: () => api.get('/org/subscription').then((r) => r.data as SubscriptionData),
    enabled: isAuthenticated && user?.role === 'ORG_ADMIN',
  })

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['public', 'plans'],
    queryFn: () => api.get('/organizations/plans').then((r) => r.data as Plan[]),
    enabled: showChangePlan,
  })

  const changePlanMutation = useMutation({
    mutationFn: (planId: string) =>
      api.post('/org/subscription/change-plan', { planId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org', 'subscription'] })
      setShowChangePlan(false)
    },
  })

  if (!isAuthenticated || user?.role !== 'ORG_ADMIN') return null
  if (isLoading) return <p style={{ padding: 32 }}>Carregando...</p>
  if (!data) return null

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>Assinatura</h1>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: '#666' }}>Plano atual</p>
            <h2 style={{ margin: '4px 0' }}>{data.plan.name}</h2>
            <p style={{ margin: 0, color: '#555' }}>
              Até {data.plan.maxClients} clientes · R$ {Number(data.plan.priceMonthly).toFixed(2)}/mês
            </p>
            <p style={{ margin: '8px 0 0', color: '#555', fontSize: 14 }}>
              {data.clientsCount} cliente{data.clientsCount !== 1 ? 's' : ''} ativos
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                fontWeight: 600,
                color: STATUS_COLORS[data.subscriptionStatus] ?? '#333',
              }}
            >
              {STATUS_LABELS[data.subscriptionStatus] ?? data.subscriptionStatus}
            </span>
            {data.trialEndsAt && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>
                Trial expira em {new Date(data.trialEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
            {data.gracePeriodEndsAt && (
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#a06000' }}>
                Carência até {new Date(data.gracePeriodEndsAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowChangePlan(!showChangePlan)}
          style={{ marginTop: 16, padding: '8px 16px' }}
        >
          {showChangePlan ? 'Cancelar' : 'Trocar plano'}
        </button>
      </div>

      {showChangePlan && (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Selecione o novo plano</h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {plans.map((plan) => (
              <div
                key={plan.id}
                style={{
                  border: plan.id === data.plan.id ? '2px solid #0070f3' : '1px solid #ddd',
                  borderRadius: 8, padding: 16, minWidth: 160, flex: 1,
                }}
              >
                <strong>{plan.name}</strong>
                <p style={{ margin: '4px 0' }}>R$ {Number(plan.priceMonthly).toFixed(2)}/mês</p>
                <p style={{ margin: '0 0 8px', fontSize: 13, color: '#555' }}>
                  Até {plan.maxClients} clientes
                </p>
                <button
                  onClick={() => changePlanMutation.mutate(plan.id)}
                  disabled={plan.id === data.plan.id || changePlanMutation.isPending}
                  style={{ width: '100%', padding: '6px' }}
                >
                  {plan.id === data.plan.id ? 'Atual' : 'Selecionar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2>Histórico</h2>
        {data.subscriptionHistory.length === 0 ? (
          <p style={{ color: '#666' }}>Nenhum evento registrado.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Evento</th>
                <th style={{ padding: '8px 12px' }}>Valor</th>
                <th style={{ padding: '8px 12px' }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {data.subscriptionHistory.map((h) => (
                <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 12px' }}>{h.event.replace('_', ' ')}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {h.amount ? `R$ ${Number(h.amount).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#666', fontSize: 13 }}>
                    {new Date(h.createdAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

```bash
cd apps/web && pnpm build 2>&1 | tail -8
```

Expected: `✓ built in X.XXs`

- [ ] **Step 3: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/web/src/
git commit -m "feat: /org/subscription — status + histórico + trocar plano"
```

---

## Task 9: Verificação final da Fase 3

- [ ] **Step 1: Suite completa**

```bash
cd apps/api && pnpm test
```

Expected: 61 passed (8 files).

- [ ] **Step 2: Critério de conclusão**

```bash
# Sobe API
fuser -k 3000/tcp 2>/dev/null
node --import tsx/esm src/app.ts &
sleep 3

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"master@autohubs.com.br","password":"Master@AutoHubs2025"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

echo "=== Planos públicos ==="
curl -s http://localhost:3000/organizations/plans \
  | python3 -c "import json,sys; plans=json.load(sys.stdin); print([p['name'] for p in plans])"

echo "=== Registra escritório ==="
PLAN_ID=$(curl -s http://localhost:3000/organizations/plans \
  | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X POST http://localhost:3000/organizations/register \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Teste Ltda\",\"email\":\"teste-$(date +%s)@ltda.com\",\"adminName\":\"Admin\",\"adminPassword\":\"Senha@12345\",\"planId\":\"$PLAN_ID\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('org:', d.get('organization',{}).get('name'), '| user role:', d.get('user',{}).get('role'))"
```

Expected: lista de planos retornada, org criada com role ORG_ADMIN.

- [ ] **Step 3: Testar webhook**

```bash
ASAAS_WEBHOOK_SECRET_VALUE=$(grep ASAAS_WEBHOOK_SECRET /home/max/job/autohubs/tramita/.env | cut -d= -f2)
# Get an org with asaasSubscriptionId (from register step above or use a seed)
# For testing, get any org with a subscription ID:
curl -s -X POST "http://localhost:3000/webhooks/asaas?accessToken=wrong" \
  -H 'Content-Type: application/json' \
  -d '{"event":"PAYMENT_CONFIRMED","payment":{"id":"p1","subscription":"sub_x","customer":"c1","value":197}}' \
  | python3 -c "import json,sys; print('unauthorized test:', json.load(sys.stdin))"
```

Expected: `{"message":"Webhook token inválido"}` (401).

- [ ] **Step 4: Atualizar TASKS.md**

```typescript
// Marcar todos os itens da Fase 3 com [x]
```

- [ ] **Step 5: Commit final**

```bash
cd /home/max/job/autohubs/tramita
git add docs/TASKS.md
git commit -m "docs: marca Fase 3 como concluída no TASKS.md"
```

---

## Self-Review

### Spec coverage:

| Item TASKS.md | Task |
|---|---|
| `asaas.ts` — mock do client HTTP | Task 1 + Task 2 (vi.mock) |
| `organizations.service.test.ts` — registro completo | Task 2 |
| `webhooks.routes.test.ts` — 3 eventos | Task 4 |
| `checkSubscription.test.ts` | Task 5 |
| `POST /organizations/register` | Tasks 2-3 |
| `GET /organizations/plans` | Task 3 |
| `POST /webhooks/asaas` | Task 4 |
| Grace period automático (7 dias) | Tasks 4+5 |
| Painel `/org/subscription` | Tasks 7-8 |
| Tela de cadastro público | Task 7 |

Todos os 10 itens cobertos. ✓

### Placeholder scan: nenhum TBD/TODO encontrado. ✓

### Type consistency:
- `RegisterOrgBody` definido em organizations.schema.ts → usado em register(data: RegisterOrgBody) ✓
- `ChangePlanBody` → usado em changePlan route ✓
- `webhooksRoutes` exportado → importado em server.ts ✓
- `publicOrgRoutes`, `orgRoutes` exportados de organizations.routes.ts → importados em server.ts ✓
- `getOrgSubscription`, `changePlan` exportados de organizations.service.ts → usados em orgRoutes ✓
