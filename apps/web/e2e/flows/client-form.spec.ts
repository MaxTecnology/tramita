// apps/web/e2e/flows/client-form.spec.ts
import { test, expect } from '../fixtures'

// Full client registration through the three tabs: company data, served department with its office
// responsible, and the client user who covers it on the portal. Save stays blocked until all three
// tabs are complete. The seed removes this client before each run.
test('cadastra cliente completo pelas três abas', async ({ orgAdminPage: page }) => {
  await page.goto('/app/clients')
  await page.getByRole('button', { name: '+ Novo cliente' }).click()
  const save = page.getByRole('button', { name: 'Cadastrar' })
  await expect(save).toBeDisabled()

  // Empresa
  await page.getByLabel('CNPJ *').fill('55103303000121')
  await page.getByLabel('Razão social *').fill('Cliente Cadastro E2E')
  await page.getByLabel('Código (ERP) *').fill('E2E-201')
  await page.getByLabel('CEP *').fill('57312675')
  await page.getByLabel('Estado *').fill('AL')
  await page.getByLabel('Cidade *').fill('Arapiraca')
  await page.getByLabel('Bairro *').fill('Centro')
  await page.getByLabel('Logradouro *').fill('Rua do Cadastro')
  await page.getByLabel('Número *').fill('10')

  // Departamentos: Geral, with the admin as responsible
  await page.getByRole('button', { name: 'Departamentos' }).click()
  await page.getByRole('checkbox', { name: 'Geral' }).check()
  await page.getByLabel('Responsável por Geral').selectOption({ label: 'Admin G2A' })
  await expect(save).toBeDisabled() // nobody on the portal covers Geral yet

  // Acesso ao portal
  await page.getByRole('button', { name: 'Acesso ao portal' }).click()
  await page.getByLabel('Nome do usuário').fill('Financeiro Cadastro')
  await page.getByLabel('E-mail do usuário').fill('cadastro-e2e@g2a.com.br')
  await page.getByLabel('Senha do usuário').fill('Cliente@2025')
  await page.getByRole('button', { name: 'Adicionar usuário' }).click()

  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Cliente Cadastro E2E')).toBeVisible({ timeout: 10_000 })
})
