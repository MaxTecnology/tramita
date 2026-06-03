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
