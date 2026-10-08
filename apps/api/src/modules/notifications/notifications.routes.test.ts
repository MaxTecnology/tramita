import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('PATCH /notifications/config', () => {
  it('persiste taskBlocked: false e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { taskBlocked: false },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    expect(getRes.statusCode).toBe(200)
    expect(JSON.parse(getRes.body).taskBlocked).toBe(false)
  })

  it('persiste recurringGenerationFailed e documentRejected (campos adicionados pra nivelar todos os eventos ao mesmo controle)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { recurringGenerationFailed: false, documentRejected: false },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    expect(getRes.statusCode).toBe(200)
    const body = JSON.parse(getRes.body)
    expect(body.recurringGenerationFailed).toBe(false)
    expect(body.documentRejected).toBe(false)
  })

  it('persiste thresholds de SLA e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { slaTargetWarningDays: 5, slaDueCriticalDays: 2, slaDigestEnabled: false },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    expect(getRes.statusCode).toBe(200)
    const body = JSON.parse(getRes.body)
    expect(body.slaTargetWarningDays).toBe(5)
    expect(body.slaDueCriticalDays).toBe(2)
    expect(body.slaDigestEnabled).toBe(false)
  })

  it('persiste lateClosureThresholdDays e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { lateClosureThresholdDays: 5 },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({ method: 'GET', url: '/notifications/config', headers: { authorization: auth } })
    expect(JSON.parse(getRes.body).lateClosureThresholdDays).toBe(5)
  })
})
