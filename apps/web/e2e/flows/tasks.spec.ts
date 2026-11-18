// apps/web/e2e/flows/tasks.spec.ts
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures'

// dnd-kit starts a drag after the pointer moves 8px: press, nudge, then travel to the column
async function dragTo(page: Page, card: Locator, column: Locator) {
  const from = await card.boundingBox()
  const to = await column.boundingBox()
  if (!from || !to) throw new Error('card or column not on screen')
  await page.mouse.move(from.x + 40, from.y + 20)
  await page.mouse.down()
  await page.mouse.move(from.x + 55, from.y + 35, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 15 })
  await page.mouse.up()
}

test('Kanban: arrastar muda o status da tarefa e a mudança fica salva', async ({ orgAdminPage: page }) => {
  await page.goto('/app/tasks')
  await page.getByRole('button', { name: 'Kanban' }).click()
  const open = page.locator('section[aria-label="Aberto"]')
  const started = page.locator('section[aria-label="Iniciado"]')
  const card = (col: Locator) => col.locator('[data-task-card]', { hasText: 'Conferência E2E' })
  await expect(card(open)).toBeVisible({ timeout: 10_000 })

  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/tasks/'))
  await dragTo(page, card(open), started)
  expect((await saved).ok()).toBeTruthy()
  await expect(card(started)).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Kanban' }).click()
  await expect(card(started)).toBeVisible({ timeout: 10_000 })

  // back to how the seed left it
  await dragTo(page, card(started), open)
  await expect(card(open)).toBeVisible({ timeout: 10_000 })
})

test('Lista: filtro de cliente fica em "Filtros" e aparece como etiqueta removível', async ({ orgAdminPage: page }) => {
  await page.goto('/app/tasks')
  await expect(page.getByRole('button', { name: 'Conferência E2E' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Filtros' }).click()
  const client = page.getByLabel('Cliente')
  const firstClient = await client.locator('option').nth(1).textContent()
  await client.selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Filtros (1)' }).click()
  const chip = page.getByRole('button', { name: `Tirar filtro Cliente: ${firstClient}` })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page.getByRole('button', { name: 'Filtros' })).toBeVisible()
})
