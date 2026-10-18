// apps/api/src/modules/document-reader/document-reader-models.service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { criarObligationType } from './document-reader-models.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

describe('criarObligationType', () => {
  it('cria uma obrigação privada da org, com code normalizado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const obrigacao = await criarObligationType(org.id, { id: admin.id }, { code: 'recibo rh', name: 'Recibo de Pagamento' })

    expect(obrigacao.code).toBe('RECIBO-RH')
    expect(obrigacao.organizationId).toBe(org.id)
    expect(obrigacao.createdById).toBe(admin.id)
  })

  it('lança 409 se já existe uma obrigação com o mesmo code nesta org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.obligationType.create({ data: { code: 'DUPLICADA', name: 'Primeira', organizationId: org.id } })

    await expect(criarObligationType(org.id, { id: admin.id }, { code: 'duplicada', name: 'Segunda' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('não colide com o code de outra organização (unicidade é por org)', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-obligation-type' })
    const adminA = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const adminB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })
    await criarObligationType(orgA.id, { id: adminA.id }, { code: 'RECIBO', name: 'Recibo A' })

    await expect(criarObligationType(orgB.id, { id: adminB.id }, { code: 'RECIBO', name: 'Recibo B' }))
      .resolves.toBeDefined()
  })

  it('remove o acento inteiro (letra+marca), não só a marca, ao normalizar o code', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const obrigacao = await criarObligationType(org.id, { id: admin.id }, { code: 'Férias', name: 'Férias' })

    // Sem NFD antes do replace, "É" inteiro seria removido (fora de [A-Z0-9-]) -> "FRIAS".
    expect(obrigacao.code).toBe('FERIAS')
  })
})
