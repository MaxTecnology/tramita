# Fase 9 (CI/Seed) + Tech Debt vi.spyOn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os itens pendentes da Fase 9 de `docs/TASKS.md` (CI no GitHub Actions cobrindo unit + E2E, cobertura mínima validada, `docker compose` + suíte completa, script de seed com planos padrão) e resolver o item pendente de `docs/tech-debt.md` (padronizar testes que mockam dependências externas para `vi.spyOn`).

**Architecture:** Nenhuma mudança de arquitetura de produto — só infraestrutura de testes/CI e dados de seed. `vi.mock(module, factory)` é substituído por `vi.spyOn(namespaceImport, 'fn')` em `beforeEach`/`afterEach` nos 4 arquivos de teste que ainda usam o padrão antigo, seguindo o padrão já existente em `attachments.service.test.ts`/`requests.service.test.ts`. O `prisma/seed.ts` (produção) ganha os 3 planos públicos placeholder mas **não** cria a org G2A — isso continua isolado em `prisma/e2e-seed.ts`, que passa a criar a org G2A + admin via `upsert` (idempotente) em vez de depender de dado criado manualmente fora do versionamento. O CI roda dois jobs: `test` (api unit/integration + coverage 80% + web unit) e `e2e` (Playwright, stack completa via serviços do GitHub Actions).

**Tech Stack:** Vitest 3, Playwright, Prisma 6, GitHub Actions, pnpm workspaces.

**Spec:** `docs/TASKS.md` (Fase 9), `docs/tech-debt.md`.

## Global Constraints

- TypeScript `strict: true` — sem `any`, sem `as unknown` (regra do `CLAUDE.md` do projeto).
- Nunca hardcodar secrets reais — valores no `.env` gerado em CI são sintéticos/efêmeros, descartados ao fim do job.
- Migrations sempre via `pnpm --filter api migrate:dev/deploy/reset` (nunca `prisma migrate` direto) — dentro do CI, `prisma migrate deploy` é chamado com `DATABASE_URL` já setado no ambiente do step, o que é equivalente e seguro (não é o CLI interativo `migrate dev`).
- Nenhum teste deve depender de rede real (MaximizeBot, Asaas, Resend, B2) — todos os pontos de saída externos devem estar mockados/interceptados.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/api/src/lib/maximizebot.test.ts` | Modificar | `vi.mock('axios')` → `vi.spyOn(axios, 'post')` |
| `apps/api/src/lib/mailer.test.ts` | Modificar | `vi.mock('resend', factory)` → `vi.spyOn(Resend.prototype, 'post')` |
| `apps/api/src/test/setup.ts` | Modificar | Fabricar `RESEND_API_KEY` de teste (necessário após parar de mockar o módulo `resend` inteiro) |
| `apps/api/src/workers/notification-worker.test.ts` | Modificar | `vi.mock('@/lib/maximizebot'/'@/lib/mailer'/'@/lib/encryption')` → `vi.spyOn` nos 3 namespace imports |
| `apps/api/src/modules/organizations/organizations.service.test.ts` | Modificar | `vi.mock('@/lib/asaas', factory)` + `vi.hoisted` → `vi.spyOn(asaas, ...)` |
| `docs/tech-debt.md` | Modificar | Marcar item 1 como resolvido |
| `apps/api/prisma/seed.ts` | Modificar | Criar planos públicos placeholder (Starter/Pro/Enterprise) |
| `apps/api/prisma/e2e-seed.ts` | Modificar | Criar org G2A + admin via `upsert` (self-contained, não depende do seed de produção) |
| `package.json` (raiz) | Modificar | Scripts `test` (agrega api+web) e `test:e2e` |
| `.github/workflows/ci.yml` | Criar | Job `test` (unit+coverage) e job `e2e` (Playwright) |
| `docs/TASKS.md` | Modificar | Checkboxes da Fase 9 após validação real |

---

## Task 1: `vi.spyOn` em `maximizebot.test.ts`

**Files:**
- Modify: `apps/api/src/lib/maximizebot.test.ts`

- [ ] **Step 1: Reescrever o arquivo**

```typescript
// apps/api/src/lib/maximizebot.test.ts
import { vi, describe, it, expect, afterEach } from 'vitest'
import axios from 'axios'
import { sendWhatsApp } from '@/lib/maximizebot'

describe('sendWhatsApp', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls MaximizeBot API with correct URL, payload and Authorization header', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} })

    await sendWhatsApp('Bearer test-token', {
      number: '5582999990001',
      body: 'Olá, João!',
      saveOnTicket: true,
      startChatbot: false,
      linkPreview: true,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://app.maximizebot.com.br/backend/api/messages/send',
      {
        number: '5582999990001',
        body: 'Olá, João!',
        saveOnTicket: true,
        startChatbot: false,
        linkPreview: true,
      },
      { headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } },
    )
  })

  it('throws when axios rejects', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('Network error'))
    await expect(
      sendWhatsApp('Bearer token', { number: '55829', body: 'test' }),
    ).rejects.toThrow('Network error')
  })
})
```

- [ ] **Step 2: Rodar o teste**

```bash
pnpm --filter api exec vitest run src/lib/maximizebot.test.ts
```
Expected: `2 passed`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/maximizebot.test.ts
git commit -m "test: padronizar maximizebot.test.ts para vi.spyOn(axios, 'post')"
```

---

## Task 2: `vi.spyOn` em `mailer.test.ts`

O SDK `resend` não exporta a classe `Emails` (só `Resend`), mas `Emails.prototype.send` delega para `this.resend.post(...)` — e `Resend.prototype.post` é o método de rede real, compartilhado por todas as instâncias via prototype. É o seam certo para espionar, análogo a `axios.post`.

Como `mailer.ts` faz `new Resend(process.env.RESEND_API_KEY)` no carregamento do módulo (não mais escondido atrás de um `vi.mock`), o construtor real agora roda nos testes e lança `Error('Missing API key...')` se a env var não existir — por isso `test/setup.ts` precisa fabricar uma chave de teste, seguindo o mesmo padrão já usado ali para `ENCRYPTION_KEY`/`JWT_*`.

**Files:**
- Modify: `apps/api/src/lib/mailer.test.ts`
- Modify: `apps/api/src/test/setup.ts`

- [ ] **Step 1: Fabricar `RESEND_API_KEY` de teste em `setup.ts`**

Em `apps/api/src/test/setup.ts`, logo após a linha `process.env.ENCRYPTION_KEY = '0'.repeat(64)` (linha 7), adicionar:

```typescript
// Dummy key — Resend real API is never called in tests (mocked via vi.spyOn on Resend.prototype.post)
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 're_test_dummy_key'
```

- [ ] **Step 2: Reescrever `mailer.test.ts`**

```typescript
import { vi, describe, it, expect, afterEach } from 'vitest'
import { Resend } from 'resend'
import { sendEmail } from '@/lib/mailer'

describe('sendEmail', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends email via Resend without error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({ data: { id: 'test-id' }, error: null })

    await expect(sendEmail('cliente@exemplo.com', 'Assunto', 'Corpo')).resolves.not.toThrow()
  })

  it('throws when Resend returns an error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({
      data: null,
      error: { message: 'API error', name: 'api_error' },
    })

    await expect(sendEmail('to@test.com', 'subject', 'body')).rejects.toThrow('API error')
  })
})
```

- [ ] **Step 3: Rodar o teste**

```bash
pnpm --filter api exec vitest run src/lib/mailer.test.ts
```
Expected: `2 passed`. Se der erro de tipo em `.mockResolvedValue`, checar a assinatura de retorno de `Resend.prototype.post` em `node_modules/.pnpm/resend@6.17.1/node_modules/resend/dist/index.d.mts` e ajustar o shape do objeto mockado (mínimo: `{ data, error }`).

- [ ] **Step 4: Rodar a suíte completa da API pra garantir que `RESEND_API_KEY` fabricada não quebrou outro teste**

```bash
pnpm --filter api test
```
Expected: todos os testes passando, nenhuma regressão.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mailer.test.ts apps/api/src/test/setup.ts
git commit -m "test: padronizar mailer.test.ts para vi.spyOn(Resend.prototype, 'post')"
```

---

## Task 3: `vi.spyOn` em `notification-worker.test.ts`

**Files:**
- Modify: `apps/api/src/workers/notification-worker.test.ts`

- [ ] **Step 1: Substituir os `vi.mock` do topo do arquivo**

Remover (linhas 19-21):
```typescript
vi.mock('@/lib/maximizebot')
vi.mock('@/lib/mailer')
vi.mock('@/lib/encryption')
```

E substituir o bloco `describe`/`beforeEach` (linhas 25-29) por:

```typescript
describe('processNotificationJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(encryption, 'decrypt').mockImplementation((encoded) => encoded)
    vi.spyOn(maximizebot, 'sendWhatsApp').mockResolvedValue(
      {} as Awaited<ReturnType<typeof maximizebot.sendWhatsApp>>,
    )
    vi.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined)
  })
```

O resto do arquivo (todas as chamadas a `maximizebot.sendWhatsApp`, `mailer.sendEmail`, incluindo o `vi.mocked(maximizebot.sendWhatsApp).mockRejectedValue(...)` no segundo teste) fica **inalterado** — os imports `import * as maximizebot from '@/lib/maximizebot'` etc. já existem no arquivo (linhas 5-7) e continuam funcionando do mesmo jeito com `vi.spyOn`.

- [ ] **Step 2: Rodar o teste**

```bash
pnpm --filter api exec vitest run src/workers/notification-worker.test.ts
```
Expected: `5 passed`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workers/notification-worker.test.ts
git commit -m "test: padronizar notification-worker.test.ts para vi.spyOn"
```

---

## Task 4: `vi.spyOn` em `organizations.service.test.ts`

**Files:**
- Modify: `apps/api/src/modules/organizations/organizations.service.test.ts`

Não estava listado no `tech-debt.md` original, mas segue exatamente o mesmo padrão frágil (`vi.mock(module, factory)` + `vi.hoisted`) descrito lá para o módulo interno `@/lib/asaas`.

- [ ] **Step 1: Substituir o topo do arquivo (linhas 1-27)**

De:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  register, getOrgSubscription, changePlan, getOrganization,
} from '@/modules/organizations/organizations.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

// vi.hoisted ensures the mock refs are available inside the vi.mock factory
const { mockCreateCustomer, mockCreateSubscription, mockCancelSubscription } = vi.hoisted(() => ({
  mockCreateCustomer: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockCancelSubscription: vi.fn(),
}))

vi.mock('@/lib/asaas', () => ({
  createCustomer: mockCreateCustomer,
  createSubscription: mockCreateSubscription,
  cancelSubscription: mockCancelSubscription,
}))

beforeEach(() => {
  mockCreateCustomer.mockResolvedValue({ id: 'cus_test123', name: 'Test', email: 'test@test.com' })
  mockCreateSubscription.mockResolvedValue({ id: 'sub_test123', status: 'ACTIVE' })
  mockCancelSubscription.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())
```

Para:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  register, getOrgSubscription, changePlan, getOrganization, createOrganizationByMaster,
} from '@/modules/organizations/organizations.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import * as asaas from '@/lib/asaas'

beforeEach(() => {
  vi.spyOn(asaas, 'createCustomer').mockResolvedValue({ id: 'cus_test123', name: 'Test', email: 'test@test.com' })
  vi.spyOn(asaas, 'createSubscription').mockResolvedValue({ id: 'sub_test123', status: 'ACTIVE' })
  vi.spyOn(asaas, 'cancelSubscription').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())
```

(o import de `createOrganizationByMaster` foi movido pra cá — remover a linha duplicada `import { createOrganizationByMaster } from '@/modules/organizations/organizations.service'` que hoje está no meio do arquivo, antes de `describe('createOrganizationByMaster', ...)`)

- [ ] **Step 2: Substituir todas as referências a `mockCreateCustomer`/`mockCreateSubscription`/`mockCancelSubscription` no corpo do arquivo**

Trocar (todas as ocorrências, `replace_all`):
- `mockCreateCustomer` → `asaas.createCustomer`
- `mockCreateSubscription` → `asaas.createSubscription`
- `mockCancelSubscription` → `asaas.cancelSubscription`

Isso afeta as linhas:
```typescript
expect(mockCreateCustomer).toHaveBeenCalledWith(...)         // → expect(asaas.createCustomer).toHaveBeenCalledWith(...)
expect(mockCreateSubscription).toHaveBeenCalledWith(...)     // → expect(asaas.createSubscription).toHaveBeenCalledWith(...)
expect(mockCreateCustomer).not.toHaveBeenCalled()            // → expect(asaas.createCustomer).not.toHaveBeenCalled()
expect(mockCreateCustomer).toHaveBeenCalledWith(...)          // (createOrganizationByMaster describe)
expect(mockCreateSubscription).toHaveBeenCalled()
mockCreateCustomer.mockRejectedValueOnce(new Error('Asaas down'))  // → vi.mocked(asaas.createCustomer).mockRejectedValueOnce(new Error('Asaas down'))
```

- [ ] **Step 3: Remover o import duplicado no meio do arquivo**

Remover a linha (hoje ~134):
```typescript
import { createOrganizationByMaster } from '@/modules/organizations/organizations.service'
```
(já foi movida para o bloco de imports do topo no Step 1)

- [ ] **Step 4: Rodar o teste**

```bash
pnpm --filter api exec vitest run src/modules/organizations/organizations.service.test.ts
```
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/organizations/organizations.service.test.ts
git commit -m "test: padronizar organizations.service.test.ts para vi.spyOn(asaas, ...)"
```

---

## Task 5: Rodar suíte completa da API e atualizar `docs/tech-debt.md`

**Files:**
- Modify: `docs/tech-debt.md`

- [ ] **Step 1: Rodar a suíte completa da API**

```bash
pnpm --filter api test
```
Expected: todos os testes passando (nenhuma regressão nas Tasks 1-4).

- [ ] **Step 2: Atualizar `docs/tech-debt.md`**

Substituir a seção `## Mocking de dependências externas em testes — padronizar em vi.spyOn` (linhas 3-9) por:

```markdown
## Mocking de dependências externas em testes — padronizado em `vi.spyOn` ✅ (resolvido em 2026-09-20)

**Contexto original:** `apps/api/src/test/setup.ts` cria uma única instância `buildApp()` no carregamento do módulo, antes que os `vi.mock(module, factory)` de cada arquivo de teste tenham chance de fazer hoist. Quando uma rota nova passa a importar de verdade um service que outro arquivo de teste mockava via `vi.mock(...)`, o app compartilhado já capturou o binding real, e o `vi.mock` do outro arquivo deixa de interceptar — causando chamadas reais (rede, fila) vazarem em testes que pareciam isolados.

**Resolvido:** todos os arquivos de teste que mockavam dependências externas via `vi.mock(module, factory)` foram convertidos para `vi.spyOn(namespaceImport, 'fn')` em `beforeEach`/`afterEach`:
- `attachments.service.test.ts`, `requests.service.test.ts`, `request-attachments.service.test.ts` (já corrigidos anteriormente)
- `maximizebot.test.ts` — `vi.spyOn(axios, 'post')`
- `mailer.test.ts` — `vi.spyOn(Resend.prototype, 'post')` (seam de rede real do SDK `resend`, já que a classe `Emails` não é exportada)
- `notification-worker.test.ts` — `vi.spyOn` em `maximizebot`, `mailer` e `encryption`
- `organizations.service.test.ts` — `vi.spyOn(asaas, ...)` (não estava listado originalmente, mas seguia o mesmo padrão frágil)

Nenhum arquivo de teste em `apps/api/src` usa mais `vi.mock(module, factory)` para dependência externa.
```

- [ ] **Step 3: Commit**

```bash
git add docs/tech-debt.md
git commit -m "docs: marcar tech-debt do vi.spyOn como resolvido"
```

---

## Task 6: Planos públicos placeholder no seed de produção

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Nota de decisão do usuário:** valores de preço/limite são placeholder — editáveis depois pelo painel Master (`/master/plans`). A org G2A **não** entra aqui, fica isolada em `prisma/e2e-seed.ts` (Task 7).

- [ ] **Step 1: Editar `apps/api/prisma/seed.ts`**

Substituir o comentário das linhas 6-11 e adicionar a criação dos planos logo após o `internalPlan` (depois da linha 23), antes do `masterOrg`:

```typescript
async function main() {
  // Plano interno só para satisfazer o vínculo obrigatório Organization.planId
  // da própria org AutoHubs — isActive: false o esconde da listagem pública de
  // registro (GET /organizations/plans), só aparece pro Master no painel
  // interno de planos.
  const internalPlan = await prisma.plan.upsert({
    where: { id: 'plan-internal-autohubs' },
    update: {},
    create: {
      id: 'plan-internal-autohubs',
      name: 'Interno (AutoHubs)',
      maxClients: 0,
      priceMonthly: 0,
      features: {},
      isActive: false,
    },
  })

  // Planos públicos — valores placeholder, editáveis pelo painel Master
  // (/master/plans) sem precisar de redeploy.
  const publicPlans = [
    { id: 'plan-starter', name: 'Starter', maxClients: 10, priceMonthly: 97 },
    { id: 'plan-pro', name: 'Pro', maxClients: 50, priceMonthly: 197 },
    { id: 'plan-enterprise', name: 'Enterprise', maxClients: 500, priceMonthly: 497 },
  ]
  for (const plan of publicPlans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: {}, isActive: true },
    })
  }
```

E atualizar a mensagem final (linha 56):
```typescript
  console.log(
    `Seed concluído: org AutoHubs + usuário MASTER (${masterEmail}) + ${publicPlans.length} planos públicos`,
  )
```

- [ ] **Step 2: Rodar o seed contra o banco de teste e conferir**

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/seed.ts
```
Expected: `Seed concluído: org AutoHubs + usuário MASTER (master@autohubs.com.br) + 3 planos públicos`

- [ ] **Step 3: Rodar de novo pra confirmar idempotência (upsert não deve duplicar nem falhar)**

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/seed.ts
```
Expected: mesma mensagem, sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(seed): criar planos públicos placeholder (Starter/Pro/Enterprise)"
```

---

## Task 7: Org G2A self-contained no `e2e-seed.ts`

**Files:**
- Modify: `apps/api/prisma/e2e-seed.ts`

Hoje o `e2e-seed.ts` faz `findUniqueOrThrow` pela org `slug: 'g2a'` e pelo usuário `admin@g2a.com.br` — presume que esses dados já existem no banco (hoje só existem porque alguém criou manualmente, fora do versionamento). Isso quebra em qualquer banco fresco (CI, onboarding de outro dev). Este task torna o script self-contained via `upsert`, sem tocar no seed de produção.

**Files:**
- Test: rodar manualmente contra o banco de teste (não há suíte automatizada pra scripts de seed — mesmo padrão do `seed.ts` hoje)

- [ ] **Step 1: Reescrever `apps/api/prisma/e2e-seed.ts`**

```typescript
// apps/api/prisma/e2e-seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Depende do seed base (prisma/seed.ts) já ter rodado antes — usa o plano
  // "Pro" criado lá. A org G2A só existe em banco de teste/E2E, nunca em
  // produção — por isso fica isolada aqui em vez de em prisma/seed.ts.
  const plan = await prisma.plan.findFirstOrThrow({ where: { name: 'Pro' } })

  const org = await prisma.organization.upsert({
    where: { slug: 'g2a' },
    update: {},
    create: {
      name: 'G2A Contabilidade',
      slug: 'g2a',
      email: 'contato@g2a.com.br',
      planId: plan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: 'admin@g2a.com.br' },
    update: {},
    create: {
      name: 'Admin G2A',
      email: 'admin@g2a.com.br',
      passwordHash: await bcrypt.hash('G2A@Admin2025', 10),
      role: 'ORG_ADMIN',
      organizationId: org.id,
    },
  })

  // Remove stale E2E data to guarantee a clean slate
  const staleBoards = await prisma.board.findMany({
    where: { organizationId: org.id, title: 'Processo E2E' },
    select: { id: true },
  })
  for (const b of staleBoards) {
    await prisma.board.delete({ where: { id: b.id } })
  }
  await prisma.client.deleteMany({
    where: { email: 'cliente@g2a.com.br', organizationId: org.id },
  })

  // Create E2E client (portal user)
  const client = await prisma.client.create({
    data: {
      name: 'Cliente E2E',
      email: 'cliente@g2a.com.br',
      passwordHash: await bcrypt.hash('Cliente@2025', 10),
      organizationId: org.id,
    },
  })

  // Create board with 3 columns and 2 tasks in the first column
  await prisma.board.create({
    data: {
      title: 'Processo E2E',
      organizationId: org.id,
      clientId: client.id,
      columns: {
        create: [
          {
            title: 'Pendente',
            position: 0,
            isFinal: false,
            color: '#6B7280',
            tasks: {
              create: [
                {
                  title: 'Abertura de empresa',
                  position: 0,
                  priority: 'HIGH',
                  status: 'OPEN',
                  tags: [],
                  creatorId: admin.id,
                },
                {
                  title: 'Inscrição estadual',
                  position: 1,
                  priority: 'MEDIUM',
                  status: 'OPEN',
                  tags: [],
                  creatorId: admin.id,
                },
              ],
            },
          },
          { title: 'Em andamento', position: 1, isFinal: false, color: '#3B82F6' },
          { title: 'Concluído', position: 2, isFinal: true, color: '#10B981' },
        ],
      },
    },
  })

  console.log('E2E seed concluído: org G2A + admin@g2a.com.br + cliente@g2a.com.br + board "Processo E2E"')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Rodar os dois seeds em sequência contra o banco de teste, do zero**

```bash
pnpm --filter api migrate:reset  # ⚠️ destrutivo — reseta o banco de teste (confirmar que DATABASE_URL_TEST aponta pro banco certo antes)
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/seed.ts
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/e2e-seed.ts
```
Expected: `E2E seed concluído: org G2A + admin@g2a.com.br + cliente@g2a.com.br + board "Processo E2E"`, sem erro de `findUniqueOrThrow`.

- [ ] **Step 3: Rodar de novo pra confirmar idempotência**

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/e2e-seed.ts
```
Expected: mesma mensagem, sem duplicar org/admin/cliente.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/e2e-seed.ts
git commit -m "fix(seed): tornar e2e-seed.ts self-contained (upsert de org G2A + admin)"
```

---

## Task 8: Scripts agregados na raiz do monorepo

**Files:**
- Modify: `package.json` (raiz)

- [ ] **Step 1: Adicionar scripts `test` e `test:e2e`**

Em `package.json` (raiz), no bloco `"scripts"`, adicionar depois de `"test:web"`:

```json
    "test": "pnpm test:api && pnpm test:web",
    "test:e2e": "pnpm --filter web test:e2e"
```

- [ ] **Step 2: Subir a infra local e rodar a suíte completa pra validar o item "docker compose up + pnpm test" da Fase 9**

```bash
docker compose up -d
pnpm test
```
Expected: `test:api` e `test:web` passam, sem erro de conexão com Postgres/Redis.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: adicionar script raiz \"test\" agregando test:api + test:web"
```

---

## Task 9: CI no GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

Dois jobs: `test` (api unit/integration + coverage 80% + web unit, roda em todo push/PR) e `e2e` (Playwright, stack completa, roda depois do `test` passar). O job `e2e` gera um `.env` efêmero na raiz do repo — só existe dentro do runner do CI, nunca é commitado, e usa valores sintéticos/dummy pra tudo que é serviço externo (Asaas, B2, Resend), já que nenhum teste E2E faz chamada real pra eles.

- [ ] **Step 1: Criar `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: tramita
          POSTGRES_PASSWORD: tramita
          POSTGRES_DB: tramita_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U tramita"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL_TEST: postgresql://tramita:tramita@localhost:5433/tramita_test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Aplicar migrations no banco de teste
        working-directory: apps/api
        run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://tramita:tramita@localhost:5433/tramita_test

      - name: Testes da API com cobertura (mínimo 80%)
        run: pnpm --filter api test:coverage

      - name: Testes do frontend
        run: pnpm --filter web test

  e2e:
    runs-on: ubuntu-latest
    needs: test
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: tramita
          POSTGRES_PASSWORD: tramita
          POSTGRES_DB: tramita_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U tramita"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Instalar Chromium do Playwright
        run: pnpm --filter web exec playwright install chromium --with-deps

      - name: Gerar .env efêmero pra E2E (chaves e segredos sintéticos, só pra este job)
        run: |
          openssl genrsa -out /tmp/private.pem 2048
          openssl rsa -in /tmp/private.pem -pubout -out /tmp/public.pem
          JWT_PRIVATE_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' /tmp/private.pem)
          JWT_PUBLIC_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' /tmp/public.pem)
          ENCRYPTION_KEY=$(openssl rand -hex 32)
          cat > .env <<EOF
          DATABASE_URL=postgresql://tramita:tramita@localhost:5433/tramita_test
          DATABASE_URL_TEST=postgresql://tramita:tramita@localhost:5433/tramita_test
          REDIS_URL=redis://localhost:6379
          JWT_PRIVATE_KEY=$JWT_PRIVATE_KEY
          JWT_PUBLIC_KEY=$JWT_PUBLIC_KEY
          ASAAS_API_KEY=ci-dummy
          ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
          ASAAS_WEBHOOK_SECRET=ci-dummy
          B2_KEY_ID=ci-dummy
          B2_APP_KEY=ci-dummy
          B2_BUCKET_NAME=tramita-ci
          B2_BUCKET_REGION=us-west-004
          B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
          PORT=3001
          NODE_ENV=test
          APP_URL=http://localhost:5173
          MASTER_EMAIL=master@autohubs.com.br
          MASTER_PASSWORD=Master@AutoHubs2025
          RESEND_API_KEY=ci-dummy
          EMAIL_FROM=Tramita <notificacoes@autohubs.com.br>
          ENCRYPTION_KEY=$ENCRYPTION_KEY
          VITE_API_URL=http://localhost:3001
          EOF
          rm /tmp/private.pem /tmp/public.pem

      - name: Rodar suíte Playwright E2E
        run: pnpm --filter web test:e2e
```

- [ ] **Step 2: Validar localmente que `pnpm exec prisma migrate deploy` funciona com `DATABASE_URL` só no env do step (sem depender do root `.env`)**

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec prisma migrate deploy
```
Expected: `No pending migrations to apply.` (ou lista as aplicadas, sem erro).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: adicionar GitHub Actions (unit+coverage e Playwright E2E)"
```

- [ ] **Step 4: Push e conferir a run no GitHub Actions**

```bash
git push
```
Depois, checar `Actions` no GitHub — os dois jobs (`test` e `e2e`) devem terminar verdes. Se `e2e` falhar por timeout do Chromium/webServer, aumentar o `timeout` em `apps/web/playwright.config.ts` (hoje 60s) antes de investigar mais fundo.

---

## Task 10: Atualizar `docs/TASKS.md` (só depois de tudo validado)

**Files:**
- Modify: `docs/TASKS.md`

Este task só deve ser executado **depois** que o CI (Task 9, Step 4) rodar verde no GitHub pelo menos uma vez — os checkboxes devem refletir o que foi de fato verificado, não o que foi escrito.

- [ ] **Step 1: Conferir cada item da seção "Testes da Fase 9" contra o resultado real do CI**

```markdown
### Testes da Fase 9
- [x] Rodar suite completa no CI (GitHub Actions) a cada push
- [x] `docker compose up` + `pnpm test` passam sem erros no ambiente limpo
- [x] Cobertura mínima 80% em `apps/api/src/modules/*/` e `apps/api/src/lib/`
- [x] Playwright E2E: login escritório → criar tarefa → mover → mensagem no log de notificações
- [x] Playwright E2E: login cliente → ver board → comentar → receber notificação (mock MaximizeBot)
```

- [ ] **Step 2: Atualizar o item do script de seed (linha 206) pra refletir a divisão feita nas Tasks 6/7**

De:
```markdown
- [ ] Script de seed: planos padrão, usuário MASTER, org G2A como primeiro cliente
```
Para:
```markdown
- [x] Script de seed: planos padrão (`prisma/seed.ts`, placeholder — editar valores reais pelo painel Master) + usuário MASTER. Org G2A como primeiro cliente fica isolada em `prisma/e2e-seed.ts` (só banco de teste/E2E, nunca produção)
```

- [ ] **Step 3: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: marcar Fase 9 como concluída (CI, coverage, E2E, seed)"
```

---

## Self-Review

- **Cobertura do escopo:** Task 1-4 cobrem os 4 arquivos frágeis identificados (3 do `tech-debt.md` original + 1 extra encontrado). Task 5 fecha o tech-debt. Tasks 6-7 resolvem o item de seed respeitando a decisão do usuário (placeholder nos planos, G2A fora do seed de produção). Task 8-9 fecham CI + `docker compose`/`pnpm test`. Task 10 fecha os checkboxes de `TASKS.md` só após validação real, não antes.
- **Sem placeholders de instrução:** todo step tem comando ou código completo, nenhum "adicionar validação apropriada" solto.
- **Consistência de tipos/nomes:** `asaas.createCustomer`/`createSubscription`/`cancelSubscription` (Task 4) batem com as assinaturas reais em `apps/api/src/lib/asaas.ts`. `Resend.prototype.post` (Task 2) bate com a assinatura real do SDK (`async post(path, entity, options = {})`). `e2e-seed.ts` (Task 7) usa o plano `'Pro'` criado por `seed.ts` (Task 6) — dependência de ordem de execução explícita no comentário do arquivo e no `global-setup.ts` já existente (que já roda `seed.ts` antes de `e2e-seed.ts`).
