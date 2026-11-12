import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('GET /users/options — id+nome dos colaboradores pra filtros', () => {
  it('ORG_MEMBER recebe só id e nome dos colaboradores ativos da própria organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const otherOrg = await createTestOrg(plan.id)
    await createTestUser(otherOrg.id, { role: 'ORG_ADMIN' })

    const res = await app.inject({
      method: 'GET',
      url: '/users/options',
      headers: { authorization: await getAuthHeader(member.email, 'Test@1234') },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>[]
    expect(body).toHaveLength(2)
    for (const u of body) expect(Object.keys(u).sort()).toEqual(['id', 'name'])
  })

  it('a lista completa (/users) continua exclusiva do admin', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: await getAuthHeader(member.email, 'Test@1234') },
    })
    expect(res.statusCode).toBe(403)
  })
})
