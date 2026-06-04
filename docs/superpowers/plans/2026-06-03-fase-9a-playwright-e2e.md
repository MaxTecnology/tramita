# Playwright E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instalar e configurar Playwright para validar os dois fluxos principais do Tramita contra servidores locais reais, com serviços externos (MaximizeBot, Asaas, B2) mockados via `page.route()`.

**Architecture:** Playwright sobe a API com `DATABASE_URL_TEST` e o frontend Vite em modo dev. Um `globalSetup` executa as migrations e semeia dados de teste antes dos testes rodarem. Fixtures de auth fazem login via API e injetam tokens no localStorage, evitando o fluxo de login em cada spec.

**Tech Stack:** `@playwright/test`, Chromium, `dotenv`, Prisma (via execSync no seed E2E), MSW já existente não é usado (Playwright intercepta a nível de rede com `page.route()`).

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/web/package.json` | Modificar | Adicionar `@playwright/test` e script `test:e2e` |
| `apps/web/playwright.config.ts` | Criar | Config com 2 webServers, globalSetup, baseURL |
| `apps/api/prisma/e2e-seed.ts` | Criar | Seed idempotente com dados E2E (client, board, tasks) |
| `apps/web/e2e/global-setup.ts` | Criar | Roda migrations + seed base + seed E2E antes dos testes |
| `apps/web/e2e/fixtures.ts` | Criar | Fixtures `orgAdminPage` e `clientPage` (auth via localStorage) |
| `apps/web/e2e/flows/org-board.spec.ts` | Criar | 4 testes: login, dashboard, board, edição de tarefa |
| `apps/web/e2e/flows/portal-client.spec.ts` | Criar | 4 testes: login, portal boards, board do cliente, comentário |

---

## Task 1: Instalar Playwright e configurar package.json

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Instalar `@playwright/test` e `dotenv`**

```bash
cd apps/web && pnpm add -D @playwright/test dotenv
```

- [ ] **Step 2: Instalar o browser Chromium**

```bash
cd apps/web && pnpm exec playwright install chromium --with-deps
```

Expected: `Chromium ... (playwright build v...)`

- [ ] **Step 3: Adicionar o script `test:e2e` ao `apps/web/package.json`**

No bloco `"scripts"`, adicionar após `"test"`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Verificar instalação**

```bash
cd apps/web && pnpm exec playwright --version
```

Expected: `Version 1.x.x`

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "chore: install @playwright/test for E2E"
```

---

## Task 2: Criar `apps/api/prisma/e2e-seed.ts`

**Files:**
- Create: `apps/api/prisma/e2e-seed.ts`

Este script é idempotente: remove dados E2E anteriores antes de criar novos. Pressupõe que o seed base (plans + G2A org + admin) já foi executado.

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/api/prisma/e2e-seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'g2a' } })
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@g2a.com.br' } })

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

  console.log('E2E seed concluído: cliente@g2a.com.br + board "Processo E2E"')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Verificar que o seed roda contra o banco de teste**

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/seed.ts
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  pnpm --filter api exec tsx prisma/e2e-seed.ts
```

Expected: `E2E seed concluído: cliente@g2a.com.br + board "Processo E2E"`

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/e2e-seed.ts
git commit -m "chore: add E2E seed script for Playwright"
```

---

## Task 3: Criar `apps/web/e2e/global-setup.ts`

**Files:**
- Create: `apps/web/e2e/global-setup.ts`

Roda antes de qualquer webServer ou teste. Aplica migrations e executa os dois seeds no banco de teste.

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/web/e2e/global-setup.ts
import { execSync } from 'child_process'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'

// Load root .env so DATABASE_URL_TEST is available
loadEnv({ path: resolve(__dirname, '../../../.env') })

const API_DIR = resolve(__dirname, '../../../apps/api')

function run(cmd: string) {
  execSync(cmd, {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST! },
    stdio: 'inherit',
  })
}

export default async function globalSetup() {
  run('pnpm exec prisma migrate deploy')
  run('pnpm exec tsx prisma/seed.ts')
  run('pnpm exec tsx prisma/e2e-seed.ts')
}
```

- [ ] **Step 2: Verificar que o TypeScript encontra `dotenv` no workspace**

```bash
cd apps/web && node -e "require('dotenv')"
```

Se retornar erro, instalar: `pnpm add -D dotenv` em `apps/web`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/global-setup.ts
git commit -m "chore: add Playwright global-setup with E2E DB seed"
```

---

## Task 4: Criar `apps/web/playwright.config.ts`

**Files:**
- Create: `apps/web/playwright.config.ts`

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/web/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

loadEnv({ path: resolve(__dirname, '../../.env') })

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // sequential to avoid DB conflicts
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        DATABASE_URL: process.env.DATABASE_URL_TEST ?? '',
      },
    },
    {
      command: 'pnpm --filter web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
```

- [ ] **Step 2: Verificar que o config é válido**

```bash
cd apps/web && pnpm exec playwright test --list
```

Expected: lista vazia ou erro de "no tests found" (normal, specs ainda não existem).

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright.config.ts
git commit -m "chore: add playwright.config.ts with dual webServer setup"
```

---

## Task 5: Criar `apps/web/e2e/fixtures.ts`

**Files:**
- Create: `apps/web/e2e/fixtures.ts`

Expõe dois fixtures de página pré-autenticada: `orgAdminPage` (ORG_ADMIN do G2A) e `clientPage` (CLIENT do portal).

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/web/e2e/fixtures.ts
import { test as base, expect, type Page, type APIRequestContext } from '@playwright/test'

const API = 'http://localhost:3000'

async function loginAndInject(
  page: Page,
  request: APIRequestContext,
  email: string,
  password: string,
) {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password },
  })
  expect(res.ok()).toBeTruthy()
  const { accessToken, refreshToken, user } = await res.json()

  await page.goto('/')
  await page.evaluate(
    ({ at, rt, u }) => {
      localStorage.setItem('accessToken', at)
      localStorage.setItem('refreshToken', rt)
      localStorage.setItem('user', JSON.stringify(u))
    },
    { at: accessToken, rt: refreshToken, u: user },
  )
}

export const test = base.extend<{
  orgAdminPage: Page
  clientPage: Page
}>({
  orgAdminPage: async ({ page, request }, use) => {
    await loginAndInject(page, request, 'admin@g2a.com.br', 'G2A@Admin2025')
    await use(page)
  },

  clientPage: async ({ page, request }, use) => {
    await loginAndInject(page, request, 'cliente@g2a.com.br', 'Cliente@2025')
    await use(page)
  },
})

export { expect }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/e2e/fixtures.ts
git commit -m "chore: add Playwright auth fixtures (orgAdminPage, clientPage)"
```

---

## Task 6: Criar `apps/web/e2e/flows/org-board.spec.ts`

**Files:**
- Create: `apps/web/e2e/flows/org-board.spec.ts`

4 testes que cobrem o fluxo do escritório: login, dashboard, abertura de board e edição de tarefa.

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/web/e2e/flows/org-board.spec.ts
import { test, expect } from '../fixtures'

// Block external service calls — none of these should reach the network
test.beforeEach(async ({ page }) => {
  await page.route('https://app.maximizebot.com.br/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://api.asaas.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://api-sandbox.asaas.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://*.backblazeb2.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
})

test.describe('Fluxo do Escritório', () => {
  test('login como ORG_ADMIN redireciona para /app/dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill('admin@g2a.com.br')
    await page.locator('input[type="password"]').fill('G2A@Admin2025')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 10_000 })
  })

  test('dashboard exibe o board "Processo E2E"', async ({ orgAdminPage: page }) => {
    await page.goto('/app/dashboard')
    await expect(page.getByText('Processo E2E')).toBeVisible({ timeout: 10_000 })
  })

  test('board exibe colunas e tarefa seeded', async ({ orgAdminPage: page }) => {
    await page.goto('/app/dashboard')
    await page.getByRole('link', { name: 'Processo E2E' }).click()
    await expect(page).toHaveURL(/\/app\/board\//, { timeout: 10_000 })

    await expect(page.getByText('Pendente')).toBeVisible()
    await expect(page.getByText('Em andamento')).toBeVisible()
    await expect(page.getByText('Concluído')).toBeVisible()
    await expect(page.getByText('Abertura de empresa')).toBeVisible()
    await expect(page.getByText('Inscrição estadual')).toBeVisible()
  })

  test('abre modal de tarefa, edita título e salva', async ({ orgAdminPage: page }) => {
    await page.goto('/app/dashboard')
    await page.getByRole('link', { name: 'Processo E2E' }).click()
    await expect(page.getByText('Abertura de empresa')).toBeVisible({ timeout: 10_000 })

    await page.getByText('Abertura de empresa').first().click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const titleInput = page.getByLabel('Título')
    await titleInput.clear()
    await titleInput.fill('Abertura de empresa E2E')
    await page.getByRole('button', { name: 'Salvar' }).click()

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Abertura de empresa E2E')).toBeVisible()
  })
})
```

- [ ] **Step 2: Rodar apenas este spec para validar**

```bash
cd apps/web && pnpm exec playwright test e2e/flows/org-board.spec.ts --headed
```

Expected: 4 testes passando. Se algum falhar por timeout, aumentar o timeout no test específico com `{ timeout: 20_000 }`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/flows/org-board.spec.ts
git commit -m "test(e2e): escritório — login, dashboard, board, edição de tarefa"
```

---

## Task 7: Criar `apps/web/e2e/flows/portal-client.spec.ts`

**Files:**
- Create: `apps/web/e2e/flows/portal-client.spec.ts`

4 testes que cobrem o fluxo do cliente final no portal: login, listagem de boards, visualização de board e comentário em tarefa.

- [ ] **Step 1: Criar o arquivo**

```typescript
// apps/web/e2e/flows/portal-client.spec.ts
import { test, expect } from '../fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://app.maximizebot.com.br/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://api.asaas.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://api-sandbox.asaas.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://*.backblazeb2.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
})

test.describe('Portal do Cliente', () => {
  test('login como CLIENT redireciona para /portal/board', async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill('cliente@g2a.com.br')
    await page.locator('input[type="password"]').fill('Cliente@2025')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/portal\/board/, { timeout: 10_000 })
  })

  test('portal exibe o board do cliente', async ({ clientPage: page }) => {
    await page.goto('/portal/board')
    await expect(page.getByText('Processo E2E')).toBeVisible({ timeout: 10_000 })
  })

  test('board do portal exibe colunas e tarefas', async ({ clientPage: page }) => {
    await page.goto('/portal/board')
    await page.getByRole('link', { name: 'Processo E2E' }).click()
    await expect(page).toHaveURL(/\/portal\/board\//, { timeout: 10_000 })

    await expect(page.getByText('Pendente')).toBeVisible()
    await expect(page.getByText('Abertura de empresa')).toBeVisible()
    await expect(page.getByText('Inscrição estadual')).toBeVisible()
  })

  test('cliente comenta em tarefa e comentário aparece na lista', async ({ clientPage: page }) => {
    await page.goto('/portal/board')
    await page.getByRole('link', { name: 'Processo E2E' }).click()
    await expect(page.getByText('Abertura de empresa')).toBeVisible({ timeout: 10_000 })

    await page.getByText('Abertura de empresa').first().click()

    // TaskDrawer opens — wait for comment field
    const commentInput = page.getByPlaceholder('Adicionar comentário...')
    await expect(commentInput).toBeVisible({ timeout: 5_000 })

    await commentInput.fill('Comentário E2E do cliente')
    await page.getByRole('button', { name: 'Enviar' }).click()

    await expect(page.getByText('Comentário E2E do cliente')).toBeVisible({ timeout: 8_000 })
  })
})
```

- [ ] **Step 2: Rodar apenas este spec**

```bash
cd apps/web && pnpm exec playwright test e2e/flows/portal-client.spec.ts --headed
```

Expected: 4 testes passando.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/flows/portal-client.spec.ts
git commit -m "test(e2e): portal cliente — login, boards, visualização, comentário"
```

---

## Task 8: Rodar suite completa e verificar

- [ ] **Step 1: Rodar todos os testes E2E**

```bash
cd apps/web && pnpm test:e2e
```

Expected output:
```
Running 8 tests using 1 worker

  ✓  org-board.spec.ts > Fluxo do Escritório > login como ORG_ADMIN...
  ✓  org-board.spec.ts > Fluxo do Escritório > dashboard exibe o board...
  ✓  org-board.spec.ts > Fluxo do Escritório > board exibe colunas...
  ✓  org-board.spec.ts > Fluxo do Escritório > abre modal de tarefa...
  ✓  portal-client.spec.ts > Portal do Cliente > login como CLIENT...
  ✓  portal-client.spec.ts > Portal do Cliente > portal exibe o board...
  ✓  portal-client.spec.ts > Portal do Cliente > board do portal...
  ✓  portal-client.spec.ts > Portal do Cliente > cliente comenta...

  8 passed (Xs)
```

- [ ] **Step 2: Se algum teste falhar, rodar em modo headed para inspecionar**

```bash
cd apps/web && pnpm exec playwright test --headed --debug
```

- [ ] **Step 3: Rodar testes Vitest existentes para garantir que nada quebrou**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 4: Commit final**

```bash
git add .
git commit -m "test(e2e): suite Playwright completa — 8 testes passando"
```

---

## Troubleshooting

**API não sobe com DATABASE_URL_TEST:**
O `dotenv` em `apps/api/src/app.ts` não sobrescreve variáveis já definidas no processo. Se o webServer não está passando a var corretamente, testar manualmente:
```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" pnpm --filter api dev
```

**`getByRole('link', { name: 'Processo E2E' })` não encontra:**
O Card da dashboard envolve o título em `CardTitle` dentro de um `Link`. Se o seletor de link não funcionar, usar:
```typescript
await page.getByText('Processo E2E').first().click()
```

**Drawer do portal não abre ao clicar na tarefa:**
A tarefa no portal usa `onClick` direto no `div`. Em caso de conflito com scroll, forçar scroll antes:
```typescript
await page.getByText('Abertura de empresa').first().scrollIntoViewIfNeeded()
await page.getByText('Abertura de empresa').first().click()
```

**`getByLabel('Título')` não encontra o input no TaskModal:**
O `Input` tem `id="task-title"` e `aria-label="Título"`. Se `getByLabel` falhar, usar:
```typescript
await page.locator('#task-title').clear()
await page.locator('#task-title').fill('...')
```
