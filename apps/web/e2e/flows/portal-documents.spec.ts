// apps/web/e2e/flows/portal-documents.spec.ts
import { test, expect } from '../fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('https://app.maximizebot.com.br/**', (route) => route.fulfill({ status: 200, body: '{}' }))
  await page.route('https://*.backblazeb2.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))
})

// The seed sends "Guia DAS E2E" (R$ 1.234,56) to the client and asks for "Extrato bancário E2E" in
// the current month. Serial: the office sees the guide unpaid → the client pays it → it leaves the
// office list.
test.describe.serial('Portal de documentos', () => {
  test('escritório vê a guia em "Guias não pagas"', async ({ orgAdminPage: page }) => {
    await page.goto('/app/guides')
    await expect(page.getByRole('heading', { name: 'Guias não pagas' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('guide-row').filter({ hasText: 'Guia DAS E2E' })).toBeVisible()
  })

  test('cliente sai do Início, abre a guia e marca como paga', async ({ clientPage: page }) => {
    await page.goto('/portal/home')
    const card = page.getByRole('link', { name: /Guias a pagar/ })
    await expect(card).toContainText('1', { timeout: 10_000 })
    await card.click()

    await expect(page.getByRole('heading', { name: 'Documentos recebidos' })).toBeVisible()
    await page.getByRole('link', { name: /Guia DAS E2E/ }).click()

    await page.getByRole('button', { name: 'Marcar como pago' }).click()
    await expect(page.getByLabel('Valor pago')).toHaveValue('1.234,56') // prefilled with the guide amount
    await page.getByRole('dialog').getByRole('button', { name: 'Marcar como pago' }).click()

    await expect(page.getByText(/Pago — R\$\s?1\.234,56/)).toBeVisible({ timeout: 8_000 })
  })

  test('a guia paga sai da lista do escritório', async ({ orgAdminPage: page }) => {
    await page.goto('/app/guides')
    await expect(page.getByText('Nenhuma guia pendente de pagamento.')).toBeVisible({ timeout: 10_000 })
  })

  test('cliente marca "Nada a enviar" no pedido do mês e pode desfazer', async ({ clientPage: page }) => {
    await page.goto('/portal/send')
    const row = page.locator('section').filter({ hasText: 'Extrato bancário E2E' })
    await expect(row).toContainText('Pendente', { timeout: 10_000 })

    await row.getByRole('button', { name: 'Nada a enviar' }).click()
    await expect(row).toContainText('Nada a enviar')
    await expect(row.getByRole('button', { name: 'Desfazer' })).toBeVisible()

    await row.getByRole('button', { name: 'Desfazer' }).click()
    await expect(row).toContainText('Pendente')
  })
})
