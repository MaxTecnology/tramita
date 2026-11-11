import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { resolveClientRecipients } from './client-recipients'
import {
  createTestClient, createTestClientUser, createTestDepartment, createTestOrg, createTestPlan, grantClientAccess,
} from '@/test/helpers'

describe('resolveClientRecipients', () => {
  it('devolve só usuários ativos com acesso ao departamento naquela empresa', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const otherClient = await createTestClient(org.id)
    const folha = await createTestDepartment(org.id)
    const fiscal = await createTestDepartment(org.id)

    const { clientUser: folhaUser } = await createTestClientUser(org.id)
    await prisma.clientUser.update({ where: { id: folhaUser.id }, data: { phone: '5582999991234' } })
    await grantClientAccess(folhaUser.id, client.id, folha.id)
    const { clientUser: fiscalUser } = await createTestClientUser(org.id)
    await grantClientAccess(fiscalUser.id, client.id, fiscal.id)
    const { clientUser: inactive } = await createTestClientUser(org.id, { isActive: false })
    await grantClientAccess(inactive.id, client.id, folha.id)
    const { clientUser: otherCompany } = await createTestClientUser(org.id)
    await grantClientAccess(otherCompany.id, otherClient.id, folha.id)

    const recipients = await resolveClientRecipients(client.id, folha.id)

    expect(recipients).toEqual([
      { id: folhaUser.id, name: folhaUser.name, email: folhaUser.email, phone: '5582999991234' },
    ])
  })
})
