import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  getAuthHeader,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { org, user, auth }
}

describe('GET /clients', () => {
  it('returns only active clients by default', async () => {
    const { org, auth } = await setup()
    await createTestClient(org.id, { isActive: true })
    await createTestClient(org.id, { isActive: false })

    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ isActive: boolean }[]>()
    expect(body.every((c) => c.isActive === true)).toBe(true)
    expect(body).toHaveLength(1)
  })

  it('returns active and inactive clients when includeInactive=true', async () => {
    const { org, auth } = await setup()
    await createTestClient(org.id, { isActive: true })
    await createTestClient(org.id, { isActive: false })

    const res = await app.inject({
      method: 'GET',
      url: '/clients?includeInactive=true',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ isActive: boolean }[]>()
    expect(body).toHaveLength(2)
  })

  it('returns 200 with empty array when org has no clients', async () => {
    const { auth } = await setup()
    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('does not return clients from another organization', async () => {
    const plan = await createTestPlan()

    const orgA = await createTestOrg(plan.id)
    const userA = await createTestUser(orgA.id)
    const authA = await getAuthHeader(userA.email, 'Test@1234')
    await createTestClient(orgA.id)

    const orgB = await createTestOrg(plan.id)
    const userB = await createTestUser(orgB.id)
    await createTestClient(orgB.id)

    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: authA } })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ id: string }[]>()
    expect(body).toHaveLength(1)
  })
})
