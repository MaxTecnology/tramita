# Cadastro de Organização pelo Master + Reset de Senha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o Master cadastre uma organização (escritório) + seu primeiro usuário ORG_ADMIN direto pelo painel, sem depender do fluxo público `/register` nem obrigatoriamente da Asaas; e permitir redefinir senha de usuários (Master para qualquer um, ORG_ADMIN para sua própria equipe).

**Architecture:** Backend Fastify + Prisma — novo endpoint `POST /master/organizations` reaproveita o padrão de transação já usado em `register()`, mas com status `ACTIVE` direto, senha gerada pelo servidor, e chamada à Asaas opcional via flag explícita. Reset de senha vira uma função de service compartilhada (`resetUserPassword`), exposta por duas rotas com escopos diferentes (org-scoped para ORG_ADMIN, global para Master). Frontend React adiciona um modal de criação na tela já existente do Master, uma tela nova de detalhe de organização, e um botão na tela de Usuários do escritório.

**Tech Stack:** Node 22, TypeScript strict, Fastify v5, Prisma v6, Zod, Vitest, React 19, TanStack Query, shadcn/ui (Dialog, Button, Input, Label, Badge, Card).

## Global Constraints

- TypeScript `strict: true` — sem `any`, sem `as unknown`.
- Validação Zod em toda entrada de rota (body/params).
- Erros via `AppError` (`apps/api/src/errors/AppError.ts`) com `statusCode` + `message`.
- Path alias `@/` → `src/` em ambos os apps.
- Senha gerada nunca é persistida em texto puro — só hash (`bcrypt`, via `hashPassword`).
- `Organization.planId` é obrigatório no schema — toda criação de org precisa de um plano válido e ativo.
- Sem testes de frontend dedicados para os modais desta entrega (fora do padrão de cobertura do projeto).
- Toda nova rota autenticada precisa de `verifyJWT` no grupo; roles via `requireRole`.

---

### Task 1: `generateRandomPassword()` — helper compartilhado

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Test: `apps/api/src/modules/auth/auth.service.test.ts`

**Interfaces:**
- Produces: `generateRandomPassword(length?: number): string` — exportado de `@/modules/auth/auth.service`. Tasks 3 e 5 importam essa função.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/modules/auth/auth.service.test.ts`, alterar a linha de import existente:

```typescript
import {
  hashPassword,
  verifyPassword,
  login,
  refreshSession,
  logout,
} from '@/modules/auth/auth.service'
```

para incluir `generateRandomPassword`:

```typescript
import {
  hashPassword,
  verifyPassword,
  login,
  refreshSession,
  logout,
  generateRandomPassword,
} from '@/modules/auth/auth.service'
```

E adicionar ao final do arquivo:

```typescript
describe('generateRandomPassword', () => {
  it('generates a 12-character password by default', () => {
    const password = generateRandomPassword()
    expect(password).toHaveLength(12)
  })

  it('never contains visually ambiguous characters', () => {
    const password = generateRandomPassword()
    expect(password).not.toMatch(/[0O1lI]/)
  })

  it('generates a different password on each call', () => {
    const a = generateRandomPassword()
    const b = generateRandomPassword()
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter api test -- auth.service.test.ts`
Expected: FAIL com `generateRandomPassword is not a function` ou erro de import.

- [ ] **Step 3: Implementar**

Em `apps/api/src/modules/auth/auth.service.ts`, adicionar (após os imports, antes de `hashPassword`):

```typescript
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'

export function generateRandomPassword(length = 12): string {
  let password = ''
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]
  }
  return password
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter api test -- auth.service.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os 3 novos)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.service.test.ts
git commit -m "feat(api): adicionar generateRandomPassword para cadastro/reset de senha pelo Master"
```

---

### Task 2: Cadastro de organização pelo Master — `POST /master/organizations`

**Files:**
- Modify: `apps/api/src/modules/organizations/organizations.schema.ts`
- Modify: `apps/api/src/modules/organizations/organizations.service.ts`
- Modify: `apps/api/src/modules/organizations/organizations.routes.ts`
- Test: `apps/api/src/modules/organizations/organizations.service.test.ts`
- Test: `apps/api/src/modules/organizations/organizations.routes.test.ts`

**Interfaces:**
- Consumes: `generateRandomPassword()` de `@/modules/auth/auth.service` (Task 1); `hashPassword` (já importado em `organizations.service.ts`); `createCustomer`/`createSubscription` de `@/lib/asaas` (dynamic import, mesmo padrão de `register()`).
- Produces: `createOrganizationByMaster(data: CreateOrgByMasterBody)` em `organizations.service.ts`, retornando `{ organization: Organization, user: { id: string; name: string; email: string; role: string }, temporaryPassword: string }`. Rota `POST /master/organizations`.

- [ ] **Step 1: Escrever o schema Zod**

Em `apps/api/src/modules/organizations/organizations.schema.ts`, adicionar ao final (antes dos `export type`):

```typescript
export const createOrgByMasterSchema = z
  .object({
    name: z.string().min(2, 'Nome obrigatório'),
    email: z.string().email('E-mail inválido'),
    phone: z.string().optional(),
    cnpj: z.string().optional(),
    planId: z.string().min(1, 'Plano obrigatório'),
    adminName: z.string().min(2, 'Nome do admin obrigatório'),
    createAsaasSubscription: z.boolean(),
  })
  .refine((data) => !data.createAsaasSubscription || !!data.cnpj, {
    message: 'CNPJ é obrigatório para criar assinatura na Asaas',
    path: ['cnpj'],
  })
```

E adicionar ao bloco de `export type` no final do arquivo:

```typescript
export type CreateOrgByMasterBody = z.infer<typeof createOrgByMasterSchema>
```

- [ ] **Step 2: Escrever os testes de service que falham**

Adicionar ao final de `apps/api/src/modules/organizations/organizations.service.test.ts`:

```typescript
import { createOrganizationByMaster } from '@/modules/organizations/organizations.service'

describe('createOrganizationByMaster', () => {
  it('creates organization with ACTIVE status and a generated password, without calling Asaas', async () => {
    const plan = await createTestPlan({ name: 'Pro' })

    const result = await createOrganizationByMaster({
      name: 'Escritório Manual',
      email: `manual-${Date.now()}@test.com`,
      planId: plan.id,
      adminName: 'Admin Manual',
      createAsaasSubscription: false,
    })

    expect(result.organization.subscriptionStatus).toBe('ACTIVE')
    expect(result.organization.asaasCustomerId).toBeNull()
    expect(result.user.role).toBe('ORG_ADMIN')
    expect(result.temporaryPassword).toHaveLength(12)
    expect(mockCreateCustomer).not.toHaveBeenCalled()

    const stored = await prisma.user.findUnique({ where: { id: result.user.id } })
    expect(stored?.passwordHash).not.toBe(result.temporaryPassword)
  })

  it('creates Asaas customer and subscription when createAsaasSubscription is true', async () => {
    const plan = await createTestPlan({ name: 'Pro' })

    const result = await createOrganizationByMaster({
      name: 'Escritório Com Asaas',
      email: `comasaas-${Date.now()}@test.com`,
      cnpj: '12345678000190',
      planId: plan.id,
      adminName: 'Admin Asaas',
      createAsaasSubscription: true,
    })

    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ cpfCnpj: '12345678000190' }),
    )
    expect(mockCreateSubscription).toHaveBeenCalled()
    expect(result.organization.asaasCustomerId).toBe('cus_test123')
  })

  it('rolls back organization and user when Asaas fails', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    mockCreateCustomer.mockRejectedValueOnce(new Error('Asaas down'))

    await expect(
      createOrganizationByMaster({
        name: 'Escritório Falho',
        email: `falho-${Date.now()}@test.com`,
        cnpj: '12345678000190',
        planId: plan.id,
        adminName: 'Admin Falho',
        createAsaasSubscription: true,
      }),
    ).rejects.toThrow('Erro ao integrar com sistema de cobrança')

    const org = await prisma.organization.findFirst({ where: { name: 'Escritório Falho' } })
    expect(org).toBeNull()
  })

  it('throws 409 when email is already registered', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const email = `dup-${Date.now()}@test.com`
    await createOrganizationByMaster({
      name: 'Primeiro', email, planId: plan.id, adminName: 'Admin', createAsaasSubscription: false,
    })

    await expect(
      createOrganizationByMaster({
        name: 'Segundo', email, planId: plan.id, adminName: 'Admin 2', createAsaasSubscription: false,
      }),
    ).rejects.toThrow('E-mail já cadastrado')
  })

  it('throws 404 when plan does not exist', async () => {
    await expect(
      createOrganizationByMaster({
        name: 'Sem Plano',
        email: `semplano-${Date.now()}@test.com`,
        planId: 'plan-inexistente',
        adminName: 'Admin',
        createAsaasSubscription: false,
      }),
    ).rejects.toThrow('Plano não encontrado')
  })
})
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `pnpm --filter api test -- organizations.service.test.ts`
Expected: FAIL com `createOrganizationByMaster is not a function` (import quebrado).

- [ ] **Step 4: Implementar `createOrganizationByMaster`**

Em `apps/api/src/modules/organizations/organizations.service.ts`:

1. Atualizar o import do topo do arquivo para incluir `generateRandomPassword`:

```typescript
import { hashPassword, generateRandomPassword } from '@/modules/auth/auth.service'
```

2. Atualizar o import de tipos para incluir o novo tipo:

```typescript
import type {
  UpdateOrgBody, RegisterOrgBody, CreateOrgByMasterBody,
} from '@/modules/organizations/organizations.schema'
```

3. Adicionar a função, após `register()` (antes de `listPublicPlans`):

```typescript
export async function createOrganizationByMaster(data: CreateOrgByMasterBody) {
  const existing = await prisma.organization.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')

  const slug = await uniqueSlug(data.name)
  const temporaryPassword = generateRandomPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.name, slug, cnpj: data.cnpj, email: data.email,
        phone: data.phone, planId: data.planId, subscriptionStatus: 'ACTIVE',
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

  if (data.createAsaasSubscription) {
    try {
      const { createCustomer, createSubscription } = await import('@/lib/asaas')
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
    } catch (err) {
      await prisma.user.delete({ where: { id: user.id } })
      await prisma.organization.delete({ where: { id: organization.id } })
      throw new AppError(502, 'Erro ao integrar com sistema de cobrança. Tente novamente.')
    }
  }

  return {
    organization,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    temporaryPassword,
  }
}
```

- [ ] **Step 5: Rodar os testes de service e confirmar que passam**

Run: `pnpm --filter api test -- organizations.service.test.ts`
Expected: PASS (todos, incluindo os 5 novos)

- [ ] **Step 6: Escrever o teste de rota que falha**

Adicionar ao final de `apps/api/src/modules/organizations/organizations.routes.test.ts`:

```typescript
describe('POST /master/organizations', () => {
  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/master/organizations',
      headers: { authorization: header },
      payload: {
        name: 'X', email: 'x@test.com', planId: plan.id,
        adminName: 'X Admin', createAsaasSubscription: false,
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('creates organization and returns temporaryPassword', async () => {
    const plan = await createTestPlan()

    const res = await app.inject({
      method: 'POST',
      url: '/master/organizations',
      headers: { authorization: masterHeader },
      payload: {
        name: 'Escritório Via Rota',
        email: `via-rota-${Date.now()}@test.com`,
        planId: plan.id,
        adminName: 'Admin Via Rota',
        createAsaasSubscription: false,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { temporaryPassword: string; organization: { subscriptionStatus: string } }
    expect(body.temporaryPassword).toHaveLength(12)
    expect(body.organization.subscriptionStatus).toBe('ACTIVE')
  })

  it('returns 400 when createAsaasSubscription is true without cnpj', async () => {
    const plan = await createTestPlan()

    const res = await app.inject({
      method: 'POST',
      url: '/master/organizations',
      headers: { authorization: masterHeader },
      payload: {
        name: 'Sem CNPJ',
        email: `semcnpj-${Date.now()}@test.com`,
        planId: plan.id,
        adminName: 'Admin',
        createAsaasSubscription: true,
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- organizations.routes.test.ts`
Expected: FAIL com 404 (rota não existe ainda)

- [ ] **Step 8: Implementar a rota**

Em `apps/api/src/modules/organizations/organizations.routes.ts`:

1. Atualizar o import de `organizations.service`:

```typescript
import {
  listOrganizations, getOrganization, updateOrganization,
  register, listPublicPlans, getOrgSubscription, changePlan,
  createOrganizationByMaster,
} from '@/modules/organizations/organizations.service'
```

2. Atualizar o import de `organizations.schema`:

```typescript
import {
  updateOrgSchema, registerOrgSchema, changePlanSchema, createOrgByMasterSchema,
} from '@/modules/organizations/organizations.schema'
```

3. Adicionar a rota dentro de `masterOrgRoutes`, após o `GET /:id`:

```typescript
  app.post('/', async (request, reply) => {
    const result = createOrgByMasterSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createOrganizationByMaster(result.data))
  })
```

- [ ] **Step 9: Rodar os testes de rota e confirmar que passam**

Run: `pnpm --filter api test -- organizations.routes.test.ts`
Expected: PASS

- [ ] **Step 10: Rodar a suíte completa da API**

Run: `pnpm --filter api test`
Expected: PASS (todos os arquivos, sem regressão)

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/organizations/
git commit -m "feat(api): adicionar POST /master/organizations para cadastro manual pelo Master"
```

---

### Task 3: Reset de senha — ORG_ADMIN redefine sua equipe

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/modules/users/users.routes.ts`
- Test: `apps/api/src/modules/users/users.service.test.ts`
- Test: `apps/api/src/modules/users/users.routes.test.ts`

**Interfaces:**
- Consumes: `generateRandomPassword()` (Task 1), `hashPassword` (de `@/modules/auth/auth.service`).
- Produces: `resetUserPassword(id: string, organizationId?: string)` em `users.service.ts`, retornando `{ id: string; name: string; email: string; temporaryPassword: string }`. Task 4 reusa essa mesma função sem passar `organizationId`.

- [ ] **Step 1: Verificar se já existem arquivos de teste para users**

Run: `ls apps/api/src/modules/users/`
Expected: deve existir (ou não) `users.service.test.ts` e `users.routes.test.ts` — se não existirem, criar do zero seguindo os imports abaixo.

- [ ] **Step 2: Escrever o teste de service que falha**

Se `apps/api/src/modules/users/users.service.test.ts` já existir, adicionar ao final. Se não existir, criar com este conteúdo completo:

```typescript
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { resetUserPassword } from '@/modules/users/users.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

describe('resetUserPassword', () => {
  it('generates a new password scoped to the given organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const originalHash = user.passwordHash

    const result = await resetUserPassword(user.id, org.id)

    expect(result.temporaryPassword).toHaveLength(12)
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.passwordHash).not.toBe(originalHash)
  })

  it('throws 404 when user belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const user = await createTestUser(orgA.id)

    await expect(resetUserPassword(user.id, orgB.id)).rejects.toThrow(AppError)
  })

  it('resets any user when organizationId is omitted', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)

    const result = await resetUserPassword(user.id)
    expect(result.temporaryPassword).toHaveLength(12)
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- users.service.test.ts`
Expected: FAIL com `resetUserPassword is not a function`

- [ ] **Step 4: Implementar `resetUserPassword`**

Em `apps/api/src/modules/users/users.service.ts`:

1. Atualizar o import do topo para incluir `generateRandomPassword`:

```typescript
import { hashPassword, generateRandomPassword } from '@/modules/auth/auth.service'
```

2. Adicionar a função ao final do arquivo:

```typescript
export async function resetUserPassword(id: string, organizationId?: string) {
  const user = await prisma.user.findFirst({
    where: { id, isActive: true, ...(organizationId ? { organizationId } : {}) },
  })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  const temporaryPassword = generateRandomPassword()
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(temporaryPassword) },
  })
  return { id: user.id, name: user.name, email: user.email, temporaryPassword }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- users.service.test.ts`
Expected: PASS

- [ ] **Step 6: Escrever o teste de rota que falha**

Se `apps/api/src/modules/users/users.routes.test.ts` já existir, adicionar ao final. Se não existir, criar com este conteúdo completo:

```typescript
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('POST /users/:id/reset-password', () => {
  it('returns 403 for ORG_MEMBER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const target = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('resets password for a team member within the same org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const target = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { temporaryPassword: string }
    expect(body.temporaryPassword).toHaveLength(12)
  })

  it('returns 404 when target user belongs to another org', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const admin = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const target = await createTestUser(orgB.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- users.routes.test.ts`
Expected: FAIL com 404 (rota não existe)

- [ ] **Step 8: Implementar a rota**

Em `apps/api/src/modules/users/users.routes.ts`:

1. Atualizar o import de `users.service`:

```typescript
import { listUsers, createUser, updateUser, deleteUser, resetUserPassword } from './users.service'
```

2. Adicionar a rota, após `app.patch('/:id', ...)`:

```typescript
  app.post('/:id/reset-password', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await resetUserPassword(id, request.user.organizationId!))
  })
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- users.routes.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/users/
git commit -m "feat(api): ORG_ADMIN pode redefinir senha de ORG_MANAGER/ORG_MEMBER da própria org"
```

---

### Task 4: Reset de senha pelo Master + lista de usuários no detalhe da org

**Files:**
- Modify: `apps/api/src/modules/organizations/organizations.service.ts`
- Modify: `apps/api/src/modules/organizations/organizations.routes.ts`
- Test: `apps/api/src/modules/organizations/organizations.service.test.ts`
- Test: `apps/api/src/modules/organizations/organizations.routes.test.ts`

**Interfaces:**
- Consumes: `resetUserPassword` de `@/modules/users/users.service` (Task 3).
- Produces: `getOrganization(id)` agora retorna também `users: { id: string; name: string; email: string; role: string; isActive: boolean }[]`. Rota `POST /master/organizations/:orgId/users/:userId/reset-password`.

- [ ] **Step 1: Escrever o teste de service que falha (getOrganization com users)**

Adicionar ao final de `apps/api/src/modules/organizations/organizations.service.test.ts`:

```typescript
import { getOrganization } from '@/modules/organizations/organizations.service'

describe('getOrganization', () => {
  it('includes the list of active users', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestUser(org.id, { role: 'ORG_ADMIN', email: `admin-${Date.now()}@test.com` })

    const result = await getOrganization(org.id)

    expect(result.users).toHaveLength(1)
    expect(result.users[0]).toMatchObject({ role: 'ORG_ADMIN' })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- organizations.service.test.ts`
Expected: FAIL — `result.users` é `undefined`

- [ ] **Step 3: Atualizar `getOrganization`**

Em `apps/api/src/modules/organizations/organizations.service.ts`, modificar `getOrganization`:

```typescript
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
      users: {
        where: { isActive: true },
        select: { id: true, name: true, email: true, role: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return {
    id: org.id, name: org.name, slug: org.slug, cnpj: org.cnpj, email: org.email,
    phone: org.phone, subscriptionStatus: org.subscriptionStatus, planId: org.planId,
    planName: org.plan.name, clientsCount: org._count.clients, usersCount: org._count.users,
    gracePeriodEndsAt: org.gracePeriodEndsAt, trialEndsAt: org.trialEndsAt,
    subscriptionHistory: org.subscriptionHistory, createdAt: org.createdAt,
    users: org.users,
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- organizations.service.test.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste de rota que falha**

Adicionar ao final de `apps/api/src/modules/organizations/organizations.routes.test.ts`:

```typescript
describe('POST /master/organizations/:orgId/users/:userId/reset-password', () => {
  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/master/organizations/${org.id}/users/${admin.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('resets password for a user in any organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const res = await app.inject({
      method: 'POST',
      url: `/master/organizations/${org.id}/users/${admin.id}/reset-password`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { temporaryPassword: string }
    expect(body.temporaryPassword).toHaveLength(12)
  })

  it('returns 404 when userId does not belong to orgId', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const userInB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })

    const res = await app.inject({
      method: 'POST',
      url: `/master/organizations/${orgA.id}/users/${userInB.id}/reset-password`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `pnpm --filter api test -- organizations.routes.test.ts`
Expected: FAIL com 404 (rota não existe)

- [ ] **Step 7: Implementar a rota**

Em `apps/api/src/modules/organizations/organizations.routes.ts`:

1. Atualizar o import de `users.service`:

```typescript
import { resetUserPassword } from '@/modules/users/users.service'
```

2. Adicionar a rota dentro de `masterOrgRoutes`, após a rota `POST /` criada na Task 2:

```typescript
  app.post('/:orgId/users/:userId/reset-password', async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string }
    const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } })
    if (!user) throw new AppError(404, 'Usuário não encontrado nesta organização')
    return reply.send(await resetUserPassword(userId))
  })
```

3. Adicionar o import de `prisma` no topo do arquivo (verificar se já não existe — hoje `organizations.routes.ts` não importa `prisma` diretamente):

```typescript
import { prisma } from '@/lib/prisma'
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `pnpm --filter api test -- organizations.routes.test.ts`
Expected: PASS

- [ ] **Step 9: Rodar a suíte completa da API**

Run: `pnpm --filter api test`
Expected: PASS (todos os arquivos, sem regressão)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/organizations/
git commit -m "feat(api): Master pode redefinir senha de qualquer usuário; getOrganization retorna lista de users"
```

---

### Task 5: Frontend — Modal "Criar organização" no Master

**Files:**
- Modify: `apps/web/src/pages/master/Organizations.tsx`

**Interfaces:**
- Consumes: `POST /master/organizations` (Task 2), `GET /master/plans` (já existe, usado por `MasterPlans`).

- [ ] **Step 1: Adicionar estado, query de planos e mutation de criação**

Em `apps/web/src/pages/master/Organizations.tsx`, atualizar os imports do topo:

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
```

Adicionar interfaces e tipos de formulário, após a interface `Org` existente:

```typescript
interface Plan {
  id: string
  name: string
  priceMonthly: number
}

type CreateOrgForm = {
  name: string
  email: string
  phone: string
  cnpj: string
  planId: string
  adminName: string
  createAsaasSubscription: boolean
}

const EMPTY_CREATE_ORG: CreateOrgForm = {
  name: '', email: '', phone: '', cnpj: '', planId: '', adminName: '', createAsaasSubscription: false,
}
```

Dentro do componente `MasterOrganizations`, após a declaração de `qc`, adicionar:

```typescript
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateOrgForm>(EMPTY_CREATE_ORG)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['master', 'plans'],
    queryFn: () => api.get('/master/plans').then((r) => r.data as Plan[]),
    enabled: showCreate,
  })

  const createOrgMutation = useMutation({
    mutationFn: () =>
      api.post('/master/organizations', {
        name: createForm.name,
        email: createForm.email,
        phone: createForm.phone || undefined,
        cnpj: createForm.cnpj || undefined,
        planId: createForm.planId,
        adminName: createForm.adminName,
        createAsaasSubscription: createForm.createAsaasSubscription,
      }).then((r) => r.data as { temporaryPassword: string }),
    onSuccess: (data) => {
      toast.success('Organização criada com sucesso')
      qc.invalidateQueries({ queryKey: ['master', 'organizations'] })
      setCreatedPassword(data.temporaryPassword)
    },
    onError: () => toast.error('Erro ao criar organização'),
  })

  function closeCreateDialog() {
    setShowCreate(false)
    setCreateForm(EMPTY_CREATE_ORG)
    setCreatedPassword(null)
  }
```

- [ ] **Step 2: Adicionar o botão "Criar organização" no cabeçalho**

Modificar o `<h1>` existente para incluir o botão ao lado:

```typescript
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          Escritórios{' '}
          <span className="text-base font-normal text-gray-400">({orgs.length})</span>
        </h1>
        <Button onClick={() => setShowCreate(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
          + Criar organização
        </Button>
      </div>
```

(Isso substitui o `<h1>` solto que existe hoje — remover a linha `<h1 className="text-xl font-bold text-gray-900 mb-6">` original e a estrutura ao redor dela.)

- [ ] **Step 3: Adicionar o Dialog de criação, com tela de confirmação de senha**

Adicionar antes do `</div>` final do componente (depois do `<Card>` da tabela):

```typescript
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) closeCreateDialog() }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          {createdPassword ? (
            <>
              <DialogHeader>
                <DialogTitle>Organização criada</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <p className="text-sm text-gray-600">
                  Senha temporária do administrador — repasse para o escritório agora,
                  ela não será mostrada novamente:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono">
                    {createdPassword}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { navigator.clipboard.writeText(createdPassword); toast.success('Copiado') }}
                  >
                    Copiar
                  </Button>
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={closeCreateDialog} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                    Fechar
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Criar organização</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div className="space-y-1">
                  <Label htmlFor="o-name">Nome do escritório *</Label>
                  <Input id="o-name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-email">E-mail *</Label>
                  <Input id="o-email" type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-phone">Telefone</Label>
                  <Input id="o-phone" value={createForm.phone} onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-plan">Plano *</Label>
                  <select
                    id="o-plan"
                    value={createForm.planId}
                    onChange={(e) => setCreateForm({ ...createForm, planId: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <option value="">Selecione um plano</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — R$ {p.priceMonthly}/mês</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="o-admin-name">Nome do administrador *</Label>
                  <Input id="o-admin-name" value={createForm.adminName} onChange={(e) => setCreateForm({ ...createForm, adminName: e.target.value })} />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="o-asaas"
                    type="checkbox"
                    checked={createForm.createAsaasSubscription}
                    onChange={(e) => setCreateForm({ ...createForm, createAsaasSubscription: e.target.checked })}
                  />
                  <Label htmlFor="o-asaas">Também criar assinatura na Asaas</Label>
                </div>
                {createForm.createAsaasSubscription && (
                  <div className="space-y-1">
                    <Label htmlFor="o-cnpj">CNPJ *</Label>
                    <Input id="o-cnpj" value={createForm.cnpj} onChange={(e) => setCreateForm({ ...createForm, cnpj: e.target.value })} />
                  </div>
                )}
                {createOrgMutation.isError && (
                  <p className="text-sm text-red-600">Erro ao criar organização. Verifique os dados.</p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeCreateDialog}>Cancelar</Button>
                  <Button
                    onClick={() => createOrgMutation.mutate()}
                    disabled={
                      createOrgMutation.isPending ||
                      !createForm.name || !createForm.email || !createForm.planId || !createForm.adminName ||
                      (createForm.createAsaasSubscription && !createForm.cnpj)
                    }
                    className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
                  >
                    {createOrgMutation.isPending ? 'Criando...' : 'Criar'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Verificar tipos e build do frontend**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros de tipo

- [ ] **Step 5: Teste manual no navegador**

Run: `pnpm --filter web dev` (e `pnpm --filter api dev` em outro terminal)

No navegador, logado como MASTER em `/master/organizations`:
1. Clicar em "Criar organização", preencher nome/email/plano/admin, deixar Asaas desmarcado, clicar "Criar".
2. Confirmar que aparece a tela com a senha gerada e botão "Copiar".
3. Fechar o modal, confirmar que a nova organização aparece na lista com status "Ativa".
4. Marcar o checkbox da Asaas e confirmar que o campo CNPJ aparece e vira obrigatório (botão "Criar" desabilitado sem ele).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/master/Organizations.tsx
git commit -m "feat(web): modal de criação de organização no painel Master"
```

---

### Task 6: Frontend — Tela de detalhe da organização (Master) com reset de senha

**Files:**
- Create: `apps/web/src/pages/master/OrganizationDetail.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/master/Organizations.tsx`

**Interfaces:**
- Consumes: `GET /master/organizations/:id` (agora retornando `users[]`, Task 4), `POST /master/organizations/:orgId/users/:userId/reset-password` (Task 4).

- [ ] **Step 1: Criar a página de detalhe**

Criar `apps/web/src/pages/master/OrganizationDetail.tsx`:

```typescript
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface OrgUser {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
}

interface OrgDetail {
  id: string
  name: string
  email: string
  planName: string
  subscriptionStatus: string
  clientsCount: number
  usersCount: number
  users: OrgUser[]
}

const ROLE_LABEL: Record<string, string> = {
  MASTER: 'Master', ORG_ADMIN: 'Admin', ORG_MANAGER: 'Gerente', ORG_MEMBER: 'Colaborador',
}

export default function MasterOrganizationDetail() {
  const { id } = useParams<{ id: string }>()
  const [resetPassword, setResetPassword] = useState<string | null>(null)

  const { data: org, isLoading } = useQuery<OrgDetail>({
    queryKey: ['master', 'organizations', id],
    queryFn: () => api.get(`/master/organizations/${id}`).then((r) => r.data as OrgDetail),
  })

  const resetMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/master/organizations/${id}/users/${userId}/reset-password`)
        .then((r) => r.data as { temporaryPassword: string }),
    onSuccess: (data) => setResetPassword(data.temporaryPassword),
    onError: () => toast.error('Erro ao redefinir senha'),
  })

  if (isLoading || !org) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-8">
      <Link to="/master/organizations" className="text-sm text-blue-600 hover:underline">
        ← Voltar
      </Link>
      <h1 className="text-xl font-bold text-gray-900 mt-2 mb-1">{org.name}</h1>
      <p className="text-sm text-gray-500 mb-6">{org.email} · {org.planName}</p>

      <Card className="mb-6">
        <CardContent className="p-4 flex gap-6 text-sm">
          <div><span className="text-gray-400">Status:</span> <Badge>{org.subscriptionStatus}</Badge></div>
          <div><span className="text-gray-400">Clientes:</span> {org.clientsCount}</div>
          <div><span className="text-gray-400">Usuários:</span> {org.usersCount}</div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold text-gray-700 mb-3">Usuários</h2>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Nome', 'E-mail', 'Perfil', 'Ações'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resetMutation.isPending}
                      onClick={() => resetMutation.mutate(u.id)}
                    >
                      Redefinir senha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!resetPassword} onOpenChange={(open) => { if (!open) setResetPassword(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Senha redefinida</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-gray-600">
              Nova senha temporária — repasse para o usuário agora, ela não será mostrada novamente:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono">{resetPassword}</code>
              <Button
                type="button"
                variant="outline"
                onClick={() => { navigator.clipboard.writeText(resetPassword!); toast.success('Copiado') }}
              >
                Copiar
              </Button>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setResetPassword(null)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Registrar a rota**

Em `apps/web/src/router.tsx`:

1. Adicionar o import, após `import MasterOrganizations from '@/pages/master/Organizations'`:

```typescript
import MasterOrganizationDetail from '@/pages/master/OrganizationDetail'
```

2. Adicionar o child route, após `{ path: 'organizations', element: <MasterOrganizations /> }`:

```typescript
      { path: 'organizations/:id', element: <MasterOrganizationDetail /> },
```

- [ ] **Step 3: Tornar o nome da organização um link, na listagem**

Em `apps/web/src/pages/master/Organizations.tsx`, atualizar o import:

```typescript
import { Link } from 'react-router-dom'
```

E trocar a célula do nome na tabela (`<td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>`) por:

```typescript
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link to={`/master/organizations/${org.id}`} className="hover:underline">
                      {org.name}
                    </Link>
                  </td>
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros de tipo

- [ ] **Step 5: Teste manual no navegador**

Com `pnpm --filter web dev` e `pnpm --filter api dev` rodando, logado como MASTER:
1. Em `/master/organizations`, clicar no nome de uma organização.
2. Confirmar que abre `/master/organizations/:id` com status, contadores, e a lista de usuários.
3. Clicar "Redefinir senha" em um usuário, confirmar que aparece o modal com a nova senha.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/master/OrganizationDetail.tsx apps/web/src/router.tsx apps/web/src/pages/master/Organizations.tsx
git commit -m "feat(web): tela de detalhe de organização no Master, com reset de senha por usuário"
```

---

### Task 7: Frontend — Reset de senha na tela de Usuários do escritório

**Files:**
- Modify: `apps/web/src/pages/app/Users.tsx`

**Interfaces:**
- Consumes: `POST /users/:id/reset-password` (Task 3).

- [ ] **Step 1: Adicionar estado e mutation de reset**

Em `apps/web/src/pages/app/Users.tsx`, dentro do componente `Users`, após a declaração de `deleteMutation`, adicionar:

```typescript
  const [resetPassword, setResetPassword] = useState<string | null>(null)

  const resetMutation = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/users/${userId}/reset-password`).then((r) => r.data as { temporaryPassword: string }),
    onSuccess: (data) => setResetPassword(data.temporaryPassword),
    onError: () => toast.error('Erro ao redefinir senha'),
  })
```

- [ ] **Step 2: Adicionar o botão na linha do usuário**

No bloco `{user.role !== 'ORG_ADMIN' && (...)}` que já contém os botões "Editar" e "Desativar", adicionar um botão "Redefinir senha" entre os dois:

```typescript
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate(user.id)}
                  className="text-gray-600 hover:text-gray-900"
                >
                  Redefinir senha
                </Button>
```

- [ ] **Step 3: Adicionar o Dialog de confirmação**

Adicionar antes do `</div>` final do componente, após o `Dialog` de edição já existente:

```typescript
      <Dialog open={!!resetPassword} onOpenChange={(open) => { if (!open) setResetPassword(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Senha redefinida</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-gray-600">
              Nova senha temporária — repasse para o usuário agora, ela não será mostrada novamente:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono">{resetPassword}</code>
              <Button
                type="button"
                variant="outline"
                onClick={() => { navigator.clipboard.writeText(resetPassword!); toast.success('Copiado') }}
              >
                Copiar
              </Button>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setResetPassword(null)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: sem erros de tipo

- [ ] **Step 5: Teste manual no navegador**

Logado como ORG_ADMIN em `/app/users`:
1. Clicar "Redefinir senha" em um `ORG_MANAGER`/`ORG_MEMBER`.
2. Confirmar que aparece o modal com a senha gerada e botão "Copiar".
3. Confirmar que o botão não aparece na linha do próprio `ORG_ADMIN` (já filtrado pelo bloco condicional existente).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/app/Users.tsx
git commit -m "feat(web): ORG_ADMIN pode redefinir senha de usuários da própria equipe"
```

---

## Verificação final

- [ ] Rodar suíte completa: `pnpm --filter api test` — todos os arquivos PASS.
- [ ] Rodar typecheck do frontend: `pnpm --filter web exec tsc --noEmit` — sem erros.
- [ ] Smoke test manual completo: Master cria organização sem Asaas → copia senha → faz logout → login com o novo ORG_ADMIN usando a senha gerada → confirma acesso ao `/app/dashboard`.
