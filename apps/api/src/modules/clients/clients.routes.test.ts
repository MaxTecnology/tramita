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
})
