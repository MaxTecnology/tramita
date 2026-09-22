import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('GET /recurring-templates — read open to ORG_MEMBER (Tarefas > Tipo de tarefa)', () => {
  it('returns 200 for ORG_MEMBER (previously 403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const header = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/recurring-templates',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 200 for ORG_MANAGER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const header = await getAuthHeader(manager.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/recurring-templates',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /recurring-templates — mutation stays ORG_ADMIN-only', () => {
  it('returns 403 for ORG_MANAGER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const header = await getAuthHeader(manager.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/recurring-templates',
      headers: { authorization: header },
      payload: { title: 'Folha de Pagamento', frequency: 'MONTHLY', dayOfMonth: 5 },
    })
    expect(res.statusCode).toBe(403)
  })
})
