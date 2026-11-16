// apps/web/e2e/flows/robot-delivery-check.spec.ts
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'

// Seed: "Simples E2E" (Cliente E2E, current month) has "Guia DAS E2E (robô)" checked by the robot.
// The fixture PDFs are read for real by the API (/check never touches the bucket); nothing gets
// delivered here — delivering with the warning accepted is covered by the API integration tests.
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const drawer = (page: Page) => page.locator('aside').filter({ hasText: 'Simples E2E' })

async function chooseFile(page: Page, file: string) {
  await page.goto('/app/tasks')
  await page.getByPlaceholder('Título, cliente ou código...').fill('Simples E2E')
  await page.getByRole('row', { name: /Simples E2E/ }).click()
  await drawer(page).getByRole('tab', { name: 'Documentos' }).click()
  const delivery = drawer(page).locator('div').filter({ hasText: /^Guia DAS E2E \(robô\)/ }).first()
  await delivery.locator('input[type=file]').setInputFiles(resolve(FIXTURES, file))
}

test.describe('Robô confere a entrega manual', () => {
  test('competência diferente: avisa e deixa escolher outro arquivo', async ({ orgAdminPage: page }) => {
    await chooseFile(page, 'das-outra-competencia.pdf')
    await expect(page.getByText('O robô encontrou divergências em das-outra-competencia.pdf')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Competência do documento: 01\/2020 — a tarefa é de \d{2}\/\d{4}/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entregar mesmo assim' })).toBeVisible()
    await page.getByRole('button', { name: 'Escolher outro arquivo' }).click()
    await expect(drawer(page).getByText('Pendente').first()).toBeVisible()
  })

  test('documento de outro cliente do escritório é bloqueado', async ({ orgAdminPage: page }) => {
    await chooseFile(page, 'das-outro-cliente.pdf')
    await expect(page.getByText('O robô bloqueou esta entrega')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Este documento é de Carteira E2E A — não pode ser entregue a Cliente E2E')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entregar mesmo assim' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Entendi' }).click()
  })
})
