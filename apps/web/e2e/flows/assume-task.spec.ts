// apps/web/e2e/flows/assume-task.spec.ts
import { test, expect, loginAndInject } from '../fixtures'

// Seed: "Ausente E2E" has the open task "Conferência E2E" in Geral; "Cobertura E2E" (Geral, sees
// colleagues) covers the absence.
test('colaborador cobre a falta do colega: vê no departamento e assume a tarefa', async ({ page, request }) => {
  await loginAndInject(page, request, 'cobertura-e2e@g2a.com.br', 'Equipe@2025')
  await page.goto('/app/tasks')

  // Opens on "Minhas": the colleague's task is not there
  await expect(page.getByRole('button', { name: 'Minhas' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Conferência E2E')).toBeHidden()

  await page.getByRole('button', { name: 'Meu departamento' }).click()
  await page.getByText('Conferência E2E').first().click()

  // Read-only until assumed
  await expect(page.getByText('Assuma a tarefa para alterá-la')).toBeVisible()
  await page.getByRole('button', { name: 'Assumir' }).click()
  await expect(page.getByText('Tarefa assumida')).toBeVisible({ timeout: 8_000 })

  await page.goto('/app/tasks')
  await page.getByRole('button', { name: 'Minhas' }).click()
  await expect(page.getByText('Conferência E2E').first()).toBeVisible({ timeout: 8_000 })
})
