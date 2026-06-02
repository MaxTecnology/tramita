import { describe, it, expect, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import {
  createMasterUser,
  getAuthHeader,
  createTestPlan,
  createTestOrg,
  createTestUser,
} from '@/test/helpers'

let masterHeader: string

beforeEach(async () => {
  const { user, password } = await createMasterUser()
  masterHeader = await getAuthHeader(user.email, password)
})

describe('GET /master/plans', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/master/plans' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for ORG_ADMIN', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const orgAdmin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(orgAdmin.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/master/plans',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns plan list for MASTER', async () => {
    await createTestPlan({ name: 'Starter' })
    const res = await app.inject({
      method: 'GET',
      url: '/master/plans',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('POST /master/plans', () => {
  it('returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/master/plans',
      headers: { authorization: masterHeader },
      payload: { name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates plan and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/master/plans',
      headers: { authorization: masterHeader },
      payload: { name: 'Pro', maxClients: 50, priceMonthly: 197, features: { pdf: true, sse: true, attachments: true } },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.name).toBe('Pro')
    expect(body.isActive).toBe(true)
  })
})

describe('PATCH /master/plans/:id', () => {
  it('updates plan name and returns 200', async () => {
    const plan = await createTestPlan({ name: 'Old' })
    const res = await app.inject({
      method: 'PATCH',
      url: `/master/plans/${plan.id}`,
      headers: { authorization: masterHeader },
      payload: { name: 'New' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('New')
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/master/plans/nonexistent',
      headers: { authorization: masterHeader },
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /master/plans/:id', () => {
  it('soft-deletes plan and returns 200', async () => {
    const plan = await createTestPlan()
    const res = await app.inject({
      method: 'DELETE',
      url: `/master/plans/${plan.id}`,
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).isActive).toBe(false)
  })

  it('returns 404 for nonexistent plan', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/master/plans/nonexistent',
      headers: { authorization: masterHeader },
    })
    expect(res.statusCode).toBe(404)
  })
})
