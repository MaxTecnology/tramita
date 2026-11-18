// apps/web/e2e/flows/settings.spec.ts
import { test, expect, loginAndInject } from '../fixtures'

test('menu lateral leva às telas e marca a atual; departamento é criado e excluído', async ({ orgAdminPage: page }) => {
  await page.goto('/app/settings')
  await page.getByRole('link', { name: /Departamentos/ }).first().click()
  await expect(page).toHaveURL(/\/app\/settings\/departments$/)

  const nav = page.getByRole('navigation', { name: 'Configurações' })
  await expect(nav.getByRole('link', { name: 'Departamentos' })).toHaveAttribute('aria-current', 'page')

  const name = `Depto E2E ${Date.now()}`
  await page.getByRole('button', { name: 'Novo departamento' }).click()
  await page.getByLabel('Nome').fill(name)
  await page.getByRole('button', { name: 'Salvar' }).click()
  const row = page.locator('[data-list-row]', { has: page.getByText(name, { exact: true }) })
  await expect(row).toContainText('0 pessoas')
  await expect(row).toContainText('0 clientes')

  await row.getByRole('button', { name: `Mais ações de ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Excluir' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click()
  await expect(row).toBeHidden({ timeout: 8_000 })

  await nav.getByRole('link', { name: 'Mensagens' }).click()
  await expect(page).toHaveURL(/\/app\/settings\/templates$/)
  await expect(nav.getByRole('link', { name: 'Mensagens' })).toHaveAttribute('aria-current', 'page')
})

test('Mensagens: só os campos do aviso, alerta de campo vazio, pede antes de descartar e volta ao padrão', async ({ orgAdminPage: page }) => {
  await page.goto('/app/settings/templates')
  await page.getByLabel('Aviso').selectOption({ label: 'Documento rejeitado' })
  const box = page.getByLabel('Mensagem')
  await expect(box).toBeEnabled()

  // A previous failed run may have left the text customized
  const back = page.getByRole('button', { name: 'Voltar ao texto padrão' })
  if (await back.isVisible()) {
    await back.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Voltar ao padrão' }).click()
    await expect(page.getByText('Texto padrão do sistema')).toBeVisible()
  }

  await expect(page.getByRole('button', { name: 'Nome do documento' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Etapa anterior' })).toHaveCount(0)

  await box.fill('Olá {{clientName}}, recusamos {{documentName}} na etapa {{fromColumn}}.')
  await expect(page.getByRole('status', { name: 'Campos que saem vazios' })).toContainText('Etapa anterior')

  // Switching with unsaved text asks; saying no keeps everything
  await page.getByLabel('Aviso').selectOption({ label: 'Tarefa criada' })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByLabel('Aviso')).toHaveValue('DOCUMENT_REJECTED')
  await expect(box).toHaveValue(/na etapa \{\{fromColumn\}\}/)

  await box.fill('Olá {{clientName}}, recusamos {{documentName}}.')
  await expect(page.getByRole('status', { name: 'Campos que saem vazios' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver prévia' }).click()
  await expect(page.getByText('Olá João Silva, recusamos Extrato bancário.')).toBeVisible()
  await page.getByRole('button', { name: 'Salvar mensagem' }).click()
  await expect(page.getByText('Personalizada pelo escritório')).toBeVisible()

  // Saved: switching no longer asks
  await page.getByLabel('Aviso').selectOption({ label: 'Tarefa criada' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('Aviso').selectOption({ label: 'Documento rejeitado' })
  await expect(box).toHaveValue('Olá {{clientName}}, recusamos {{documentName}}.')

  await page.getByRole('button', { name: 'Voltar ao texto padrão' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Voltar ao padrão' }).click()
  await expect(page.getByText('Texto padrão do sistema')).toBeVisible()
})

test('gestor só vê em Configurações o que pode abrir', async ({ page, request }) => {
  await loginAndInject(page, request, 'gestor-e2e@g2a.com.br', 'Equipe@2025')
  await page.goto('/app/settings')
  await expect(page.getByRole('link', { name: /Acessos ao portal/ }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Departamentos/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Mensagens/ })).toHaveCount(0)
  await page.goto('/app/settings/departments')
  await expect(page.getByRole('button', { name: 'Novo departamento' })).toHaveCount(0)
})
