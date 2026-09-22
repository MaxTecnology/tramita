import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('GET /departments — Fastify addHook retroactivity regression', () => {
  it('ORG_MEMBER can list departments (200, not 403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/departments',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /departments — mutation stays ORG_ADMIN-only', () => {
  it('returns 403 for ORG_MEMBER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/departments',
      headers: { authorization: header },
      payload: { name: 'Fiscal' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 201 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/departments',
      headers: { authorization: header },
      payload: { name: 'Fiscal' },
    })
    expect(res.statusCode).toBe(201)
  })
})
