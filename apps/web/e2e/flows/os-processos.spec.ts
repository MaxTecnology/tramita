// apps/web/e2e/flows/os-processos.spec.ts
import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

// Seed: models "Certidão E2E" (3 business days), "Recálculo DAS E2E" (asks the month); "OS atrasada E2E"
// (deadline passed in January); process "Abertura ACME E2E" where "Registro E2E" waits for "Consulta E2E".
const drawer = (page: Page, title: string) => page.locator('aside').filter({ hasText: title })

// Opened from the OS list (the row goes to Tarefas with the drawer open): Tarefas itself starts
// filtered by this month's target, and a late OS from January is not in it
async function openTask(page: Page, title: string) {
  await page.goto('/app/os')
  await page.getByLabel('Buscar ordens de serviço').fill(title)
  await page.getByRole('link', { name: title, exact: true }).first().click()
  await expect(drawer(page, title)).toBeVisible()
}

test.describe.serial('Ordens de Serviço e processos', () => {
  test('escritório abre uma OS e ela aparece na lista com o prazo', async ({ orgAdminPage: page }) => {
    await page.goto('/app/os')
    await page.getByRole('button', { name: 'Nova OS' }).click()
    await page.getByLabel('Modelo de OS').selectOption({ label: 'Certidão E2E' })
    await page.getByLabel('Cliente', { exact: true }).selectOption({ label: 'E2E-001 - Cliente E2E' })
    await page.getByRole('button', { name: 'Abrir OS' }).click()
    await expect(page).toHaveURL(/\/app\/tasks\?task=/)
    await page.goto('/app/os')
    const row = page.locator('[data-list-row]', { hasText: 'Certidão E2E' }).filter({ hasNotText: 'atrasada' }).first()
    await expect(row).toContainText(/faltam 3 dias úteis/)
  })

  test('concluir uma OS atrasada pede o motivo', async ({ orgAdminPage: page }) => {
    await page.goto('/app/os')
    await page.getByRole('radio', { name: 'Atrasadas' }).click()
    await expect(page.locator('[data-list-row]', { hasText: 'OS atrasada E2E' })).toContainText('atrasada há')
    await openTask(page, 'OS atrasada E2E')
    await drawer(page, 'OS atrasada E2E').locator('select').filter({ has: page.locator('option[value="DONE"]') }).selectOption('DONE')
    await page.getByLabel('Motivo', { exact: true }).selectOption({ label: 'Retrabalho interno' })
    await page.getByRole('button', { name: 'Concluir' }).click()
    await expect(page.getByText('Tarefa atualizada')).toBeVisible({ timeout: 8_000 })
  })

  test('uma OS do processo espera a anterior e é liberada quando ela termina', async ({ orgAdminPage: page }) => {
    await openTask(page, 'Registro E2E')
    await expect(drawer(page, 'Registro E2E').getByText('aguardando Consulta E2E')).toBeVisible()
    await openTask(page, 'Consulta E2E')
    await drawer(page, 'Consulta E2E').locator('select').filter({ has: page.locator('option[value="DONE"]') }).selectOption('DONE')
    await expect(page.getByText('Tarefa atualizada')).toBeVisible({ timeout: 8_000 })
    await openTask(page, 'Registro E2E')
    await expect(drawer(page, 'Registro E2E').getByText('aguardando Consulta E2E')).toHaveCount(0)
    await expect(drawer(page, 'Registro E2E').getByText(/faltam 3 dias úteis|falta|vence hoje/)).toBeVisible()
  })

  test('cliente solicita um serviço informando o mês', async ({ clientPage: page }) => {
    await page.goto('/portal/requests')
    await page.getByRole('button', { name: /Nova solicitação/ }).click()
    await page.getByLabel('Serviço').selectOption({ label: 'Recálculo DAS E2E' })
    await page.getByLabel('Competência').fill('2025-03')
    await page.getByRole('button', { name: /Enviar/ }).click()
    await expect(page.getByText('Solicitação enviada')).toBeVisible({ timeout: 8_000 })
  })
})
