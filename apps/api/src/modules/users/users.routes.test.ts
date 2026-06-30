import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('POST /users/:id/reset-password', () => {
  it('returns 403 for ORG_MEMBER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const target = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('resets password for a team member within the same org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const target = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { temporaryPassword: string }
    expect(body.temporaryPassword).toHaveLength(12)
  })

  it('returns 404 when target user belongs to another org', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const admin = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const target = await createTestUser(orgB.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/users/${target.id}/reset-password`,
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(404)
  })
})
