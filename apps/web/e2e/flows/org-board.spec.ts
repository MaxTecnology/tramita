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

  test('lista de processos exibe o board "Processo E2E"', async ({ orgAdminPage: page }) => {
    await page.goto('/app/processes')
    // BoardRow renders both a mobile card and a desktop row for the same
    // Link (one hidden via CSS per viewport, both present in the DOM) —
    // .last() is the desktop variant, visible at Playwright's default viewport
    await expect(page.getByText('Processo E2E').last()).toBeVisible({ timeout: 10_000 })
  })

  test('board exibe colunas e tarefa seeded', async ({ orgAdminPage: page }) => {
    await page.goto('/app/processes')
    await page.getByText('Processo E2E').last().click()
    await expect(page).toHaveURL(/\/app\/board\//, { timeout: 10_000 })
    // The board query + SSE stream connect right after navigation and briefly
    // re-render ("Carregando board..."); a short settle wait here avoids a
    // race where the very next assertion runs mid-transition
    await page.waitForTimeout(1000)

    await expect(page.getByText('Pendente')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Em andamento')).toBeVisible()
    await expect(page.getByText('Concluído')).toBeVisible()
    await expect(page.getByText('Abertura de empresa')).toBeVisible()
    await expect(page.getByText('Inscrição estadual')).toBeVisible()
  })

  test('abre drawer de tarefa, edita título e salva', async ({ orgAdminPage: page }) => {
    await page.goto('/app/processes')
    await page.getByText('Processo E2E').last().click()
    await expect(page.getByText('Abertura de empresa')).toBeVisible({ timeout: 10_000 })

    await page.getByText('Abertura de empresa').first().click()

    // TaskDrawer is a side panel (role="complementary"/aside), not a modal
    // dialog — scope everything to it since the page nav is also complementary.
    // Filter on "Comentários" (a tab label that's always present), not on the
    // task title — the title text moves into an <input> value once editing
    // starts, and Playwright's hasText/getByText don't match input values.
    const drawer = page.locator('aside').filter({ hasText: 'Comentários' })
    await expect(drawer.getByRole('heading', { name: 'Abertura de empresa', level: 2 })).toBeVisible()

    // Title is edited inline: click the heading to reveal an (unlabeled,
    // autofocused) text input, type, then blur/Enter auto-saves — there is
    // no separate "Salvar" button for the title field
    await drawer.getByRole('heading', { name: 'Abertura de empresa', level: 2 }).click()
    // Exclude the due-date <input type="date"> (always rendered for
    // ORG_ADMIN regardless of title-edit state) — only the title input has no type
    const titleInput = drawer.locator('input:not([type="date"])').first()
    await expect(titleInput).toBeFocused()
    await titleInput.fill('Abertura de empresa E2E')
    await expect(titleInput).toHaveValue('Abertura de empresa E2E')
    await titleInput.press('Enter')

    // Assert on the kanban card, not the drawer's own heading: the mutation
    // does persist (board query refetches and the card updates), but the
    // open drawer keeps showing the pre-edit title until it's closed and
    // reopened — a real, separate staleness quirk in TaskDrawer, not a test bug
    await expect(page.getByRole('button', { name: /Abertura de empresa E2E/ })).toBeVisible({ timeout: 5_000 })
  })
})
