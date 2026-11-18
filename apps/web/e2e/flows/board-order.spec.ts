// apps/web/e2e/flows/board-order.spec.ts
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

// Seed: "Processo E2E" has "Abertura de empresa" then "Inscrição estadual" in "Pendente"
async function openBoard(page: Page) {
  await page.goto('/app/processes')
  await page.getByRole('link', { name: 'Processo E2E', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Processo E2E' })).toBeVisible({ timeout: 10_000 })
}
const titles = (page: Page, column: string) =>
  page.getByRole('region', { name: column, exact: true }).locator('[data-board-card] p.font-medium').allTextContents()

test('quadro: reordenar na coluna arrastando e mover pelo teclado ficam salvos', async ({ orgAdminPage: page }) => {
  await openBoard(page)
  await expect.poll(() => titles(page, 'Pendente')).toEqual(['Abertura de empresa', 'Inscrição estadual'])

  // Drag the second card onto the first: it takes its place
  const second = page.locator('[data-board-card]', { hasText: 'Inscrição estadual' })
  const first = page.locator('[data-board-card]', { hasText: 'Abertura de empresa' })
  const from = (await second.boundingBox())!
  const to = (await first.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + 15)
  await page.mouse.down()
  await page.mouse.move(from.x + 45, from.y + 5, { steps: 5 })
  await page.mouse.move(to.x + 40, to.y + 5, { steps: 15 })
  await page.mouse.up()
  await expect.poll(() => titles(page, 'Pendente')).toEqual(['Inscrição estadual', 'Abertura de empresa'])

  // Keyboard: Space picks the card up, the arrow takes it to the next column, Space drops it
  await page.locator('[data-board-card]', { hasText: 'Abertura de empresa' }).focus()
  // (a short pause between keys, as a person types: the pick up settles before the move)
  await page.keyboard.press('Space')
  await page.waitForTimeout(200)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(200)
  await page.keyboard.press('Space')
  await expect.poll(() => titles(page, 'Em andamento')).toEqual(['Abertura de empresa'])

  await page.reload()
  await expect.poll(() => titles(page, 'Pendente'), { timeout: 10_000 }).toEqual(['Inscrição estadual'])
  await expect.poll(() => titles(page, 'Em andamento')).toEqual(['Abertura de empresa'])

  // Enter opens the card
  await page.locator('[data-board-card]', { hasText: 'Inscrição estadual' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('aside').filter({ hasText: 'Inscrição estadual' })).toBeVisible()
})
