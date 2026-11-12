// apps/web/e2e/flows/user-transfer.spec.ts
import { test, expect } from '../fixtures'

// The seed makes "Saída E2E" responsible for two clients (E2E-101, E2E-102). The office moves them to
// "Destino E2E" in two batches and then deactivates the person who left.
test('transfere a carteira em dois lotes e desativa o colaborador', async ({ orgAdminPage: page }) => {
  await page.goto('/app/users')
  // innermost element holding both the e-mail and the actions of that user
  const card = page.locator('div', { has: page.getByText('saida-e2e@g2a.com.br') })
    .filter({ has: page.getByRole('button', { name: 'Transferir' }) }).last()
  await card.getByRole('button', { name: 'Transferir' }).click()
  await expect(page).toHaveURL(/\/app\/users\/[^/]+\/transfer/, { timeout: 10_000 })

  const destination = page.getByLabel('Colaborador de destino')

  // Batch 1: only E2E-101
  await page.getByText('E2E-101 - Carteira E2E A').click()
  await destination.selectOption({ label: 'Destino E2E' })
  await page.getByRole('button', { name: 'Transferir 1 cliente(s)' }).click()
  await expect(page.getByText('E2E-101 - Carteira E2E A')).toBeHidden({ timeout: 8_000 })

  // Batch 2: the remaining one
  await page.getByText('E2E-102 - Carteira E2E B').click()
  await destination.selectOption({ label: 'Destino E2E' })
  await page.getByRole('button', { name: 'Transferir 1 cliente(s)' }).click()

  await expect(page.getByText('Este colaborador não tem mais clientes, processos nem tarefas abertas.')).toBeVisible({ timeout: 8_000 })
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Desativar colaborador' }).click()

  await expect(page).toHaveURL(/\/app\/users$/, { timeout: 8_000 })
  await expect(page.getByText('saida-e2e@g2a.com.br')).toBeHidden()
})
