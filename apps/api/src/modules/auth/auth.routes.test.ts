import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/jwt'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg } from '@/test/helpers'

let orgId: string

beforeEach(async () => {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  orgId = org.id
})

describe('POST /auth/login', () => {
  it('returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-email', password: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 for wrong password', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('correct', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@test.com', password: 'any' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with tokens and user for valid ORG_ADMIN credentials', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user.role).toBe('ORG_ADMIN')
  })

  it('JWT payload contains correct role and organizationId', async () => {
    await prisma.user.create({
      data: {
        name: 'Manager',
        email: 'manager@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_MANAGER',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'manager@test.com', password: 'Pass@123' },
    })
    const { accessToken } = JSON.parse(res.body)
    const decoded = verifyAccessToken(accessToken)
    expect(decoded.role).toBe('ORG_MANAGER')
    expect(decoded.organizationId).toBe(orgId)
  })

  it('returns CLIENT role for client login', async () => {
    await prisma.client.create({
      data: {
        name: 'Cliente',
        email: 'cliente@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cliente@test.com', password: 'Pass@123' },
    })
    expect(res.statusCode).toBe(200)
    const { user } = JSON.parse(res.body)
    expect(user.role).toBe('CLIENT')
  })
})

describe('POST /auth/refresh', () => {
  it('returns 200 with new access token for valid refresh token', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    const { refreshToken } = JSON.parse(loginRes.body)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).accessToken).toBeTruthy()
  })

  it('returns 401 for unknown refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'invalid-token-uuid' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('returns 204 and invalidates refresh token', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    const { refreshToken } = JSON.parse(loginRes.body)

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    })
    expect(logoutRes.statusCode).toBe(204)

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    })
    expect(refreshRes.statusCode).toBe(401)
  })
})
