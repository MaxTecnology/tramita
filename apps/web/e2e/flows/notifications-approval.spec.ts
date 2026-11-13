// apps/web/e2e/flows/notifications-approval.spec.ts
import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('https://app.maximizebot.com.br/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://*.backblazeb2.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
})

// Seed: "Folha E2E" (current month) has an unread office message and "Prévia da folha E2E" waiting
// for approval; "Décimo terceiro E2E" has "Prévia do 13º E2E" waiting. Serial: the client reads and
// answers the conversation, approves the payroll preview; the office completes the task, and closes
// the 13th preview outside the portal (completion was blocked until then).
const drawer = (page: Page, title: string) => page.locator('aside').filter({ hasText: title })
const statusSelect = (page: Page, title: string) => drawer(page, title).locator('select').filter({ has: page.locator('option[value="DONE"]') })

async function openTask(page: Page, title: string) {
  await page.goto('/app/tasks')
  await page.getByPlaceholder('Título, cliente ou código...').fill(title)
  await page.getByRole('row', { name: new RegExp(title) }).click()
  await expect(drawer(page, title)).toBeVisible()
}

test.describe.serial('Central de notificações, conversa e aprovação', () => {
  test('cliente vê o sino, abre a conversa pela notificação e responde', async ({ clientPage: page }) => {
    await page.goto('/portal/home')
    const bell = page.getByRole('button', { name: /Notificações \(1 não lidas\)/ })
    await expect(bell).toBeVisible({ timeout: 10_000 })
    await bell.click()
    await page.getByText('Novo comentário do escritório em "Folha E2E"').click()

    await expect(page).toHaveURL(/\/portal\/send\?competence=\d{4}-\d{2}&task=/)
    await expect(page.getByText('Segue a prévia da folha, confere por favor?')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Notificações', exact: true })).toBeVisible() // read: no counter

    await page.getByPlaceholder('Adicionar comentário...').fill('Conferido, pode seguir')
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByText('Conferido, pode seguir')).toBeVisible({ timeout: 8_000 })
  })

  test('cliente aprova a prévia da folha pelo cartão do Início', async ({ clientPage: page }) => {
    await page.goto('/portal/home')
    const card = page.getByRole('link', { name: /Aguardando sua aprovação/ })
    await expect(card).toContainText('2', { timeout: 10_000 })
    await card.click()

    const group = page.locator('section').filter({ hasText: 'Prévia da folha E2E' })
    await group.getByRole('button', { name: 'Aprovar' }).click()
    await expect(group.getByText(/Aprovado por Cliente E2E em/)).toBeVisible({ timeout: 8_000 })
  })

  test('escritório é avisado no sino e conclui a tarefa aprovada', async ({ orgAdminPage: page }) => {
    await page.goto('/app/dashboard')
    await page.getByRole('button', { name: /Notificações \(\d+ não lidas\)/ }).first().click()
    await page.getByText(/Cliente E2E aprovou "Prévia da folha E2E"/).click()

    await expect(page).toHaveURL(/\/app\/tasks\?task=/)
    await expect(drawer(page, 'Folha E2E')).toBeVisible({ timeout: 10_000 })
    await statusSelect(page, 'Folha E2E').selectOption('DONE')
    await expect(page.getByText('Tarefa atualizada')).toBeVisible({ timeout: 8_000 })
  })

  test('escritório não conclui com aprovação pendente e fecha sem o portal', async ({ orgAdminPage: page }) => {
    await openTask(page, 'Décimo terceiro E2E')
    await expect(drawer(page, 'Décimo terceiro E2E').getByText('Aguardando aprovação do cliente').first()).toBeVisible()

    await statusSelect(page, 'Décimo terceiro E2E').selectOption('DONE')
    await expect(page.getByText('Há aprovação do cliente pendente')).toBeVisible({ timeout: 8_000 })

    await drawer(page, 'Décimo terceiro E2E').getByRole('button', { name: 'Documentos' }).click()
    await page.getByRole('button', { name: 'Fechar sem o portal' }).click()
    await page.getByLabel('Sem resposta do cliente').check()
    await page.getByLabel('Observação').fill('Cobrado por WhatsApp duas vezes, sem retorno')
    await page.getByRole('button', { name: 'Registrar fechamento' }).click()
    await expect(page.getByText(/Fechado pelo escritório: sem resposta do cliente/)).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText(/esperou 2 dias/)).toBeVisible()
  })
})
