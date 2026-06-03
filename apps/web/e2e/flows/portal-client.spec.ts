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
