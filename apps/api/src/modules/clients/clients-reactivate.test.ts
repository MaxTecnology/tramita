import { describe, expect, it } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, getAuthHeader } from '@/test/helpers'

async function setup(maxClients = 10) {
  const plan = await createTestPlan()
  await prisma.plan.update({ where: { id: plan.id }, data: { maxClients } })
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  return { org, auth: await getAuthHeader(admin.email, 'Test@1234') }
}
const reactivate = (auth: string, id: string) => app.inject({ method: 'POST', url: `/clients/${id}/reactivate`, headers: { authorization: auth } })

describe('reativar cliente', () => {
  it('a deactivated client comes back active', async () => {
    const s = await setup()
    const client = await createTestClient(s.org.id, { isActive: false })
    const res = await reactivate(s.auth, client.id)
    expect(res.statusCode).toBe(200)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).isActive).toBe(true)
  })

  it('respects the plan limit, like a new client', async () => {
    const s = await setup(1)
    await createTestClient(s.org.id)
    const inactive = await createTestClient(s.org.id, { isActive: false })
    const res = await reactivate(s.auth, inactive.id)
    expect(res.statusCode).toBe(422)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: inactive.id } })).isActive).toBe(false)
  })

  it('an active client or one of another office is not found; a member cannot', async () => {
    const s = await setup()
    expect((await reactivate(s.auth, (await createTestClient(s.org.id)).id)).statusCode).toBe(404)
    const other = await setup()
    expect((await reactivate(s.auth, (await createTestClient(other.org.id, { isActive: false })).id)).statusCode).toBe(404)
    const member = await createTestUser(s.org.id, { role: 'ORG_MEMBER' })
    expect((await reactivate(await getAuthHeader(member.email, 'Test@1234'), (await createTestClient(s.org.id, { isActive: false })).id)).statusCode).toBe(403)
  })
})
