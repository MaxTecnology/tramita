import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import {
  createMasterUser,
  getAuthHeader,
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
} from '@/test/helpers'

let masterHeader: string

beforeEach(async () => {
  const { user, password } = await createMasterUser()
  masterHeader = await getAuthHeader(user.email, password)
})

describe('GET /master/organizations', () => {
  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns list with subscription status and counts', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestUser(org.id)
    await createTestClient(org.id)

    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{
      id: string
      subscriptionStatus: string
      clientsCount: number
      usersCount: number
    }>
    const testOrg = body.find((o) => o.id === org.id)
    expect(testOrg).toBeDefined()
    expect(testOrg?.subscriptionStatus).toBe('ACTIVE')
    expect(testOrg?.clientsCount).toBe(1)
    expect(testOrg?.usersCount).toBe(1)
  })
})

describe('GET /master/organizations/:id', () => {
  it('returns org details with subscriptionHistory array', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const res = await app.inject({
      method: 'GET',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBe(org.id)
    expect(Array.isArray(body.subscriptionHistory)).toBe(true)
  })

  it('returns 404 for nonexistent org', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/master/organizations/nonexistent',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PATCH /master/organizations/:id', () => {
  it('can suspend org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'SUSPENDED' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).subscriptionStatus).toBe('SUSPENDED')
  })

  it('can reactivate suspended org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.organization.update({
      where: { id: org.id },
      data: { subscriptionStatus: 'SUSPENDED' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'ACTIVE' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).subscriptionStatus).toBe('ACTIVE')
  })

  it('can change plan', async () => {
    const oldPlan = await createTestPlan({ name: 'Starter' })
    const newPlan = await createTestPlan({ name: 'Pro', maxClients: 100 })
    const org = await createTestOrg(oldPlan.id)

    const res = await app.inject({
      method: 'PATCH',
      url: `/master/organizations/${org.id}`,
      headers: { authorization: masterHeader },
      payload: { planId: newPlan.id },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).planId).toBe(newPlan.id)
  })

  it('returns 404 for nonexistent org', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/master/organizations/nonexistent',
      headers: { authorization: masterHeader },
      payload: { subscriptionStatus: 'ACTIVE' },
    })
    expect(res.statusCode).toBe(404)
  })
})
