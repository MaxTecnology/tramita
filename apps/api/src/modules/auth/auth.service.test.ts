import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { generateAccessToken, verifyAccessToken } from '@/lib/jwt'
import {
  hashPassword,
  verifyPassword,
  login,
  refreshSession,
  logout,
} from '@/modules/auth/auth.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

describe('hashPassword', () => {
  it('produces a different string', async () => {
    const hash = await hashPassword('secret123')
    expect(hash).not.toBe('secret123')
    expect(hash.length).toBeGreaterThan(20)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    expect(await verifyPassword('correct', hash)).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('generateAccessToken / verifyAccessToken', () => {
  it('encodes and decodes payload correctly', () => {
    const payload = { sub: 'user-1', role: 'ORG_ADMIN' as const, organizationId: 'org-1' }
    const token = generateAccessToken(payload)
    const decoded = verifyAccessToken(token)
    expect(decoded.sub).toBe('user-1')
    expect(decoded.role).toBe('ORG_ADMIN')
    expect(decoded.organizationId).toBe('org-1')
  })
})

describe('login', () => {
  let orgId: string

  beforeEach(async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    orgId = org.id
  })

  it('returns tokens and user for valid ORG_ADMIN credentials', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123', role: 'ORG_ADMIN' })

    const result = await login(email, 'Pass@123')

    expect(result.user.role).toBe('ORG_ADMIN')
    expect(result.user.organizationId).toBe(orgId)
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
  })

  it('stores refresh token in Redis', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123' })
    const result = await login(email, 'Pass@123')

    const stored = await redis.get(`refresh:${result.refreshToken}`)
    expect(stored).toBeTruthy()
  })

  it('returns CLIENT role for client credentials', async () => {
    const clientEmail = `client-${Date.now()}@test.com`
    await prisma.client.create({
      data: {
        name: 'Test Client',
        email: clientEmail,
        passwordHash: await bcrypt.hash('Client@123', 10),
        organizationId: orgId,
      },
    })

    const result = await login(clientEmail, 'Client@123')

    expect(result.user.role).toBe('CLIENT')
    expect(result.user.organizationId).toBe(orgId)
  })

  it('throws 401 for wrong password', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123' })

    await expect(login(email, 'wrong')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 for nonexistent email', async () => {
    await expect(login('nobody@test.com', 'any')).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('refreshSession', () => {
  it('returns new access token for valid refresh token', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    const result = await refreshSession(refreshToken)

    expect(result.accessToken).toBeTruthy()
    const decoded = verifyAccessToken(result.accessToken)
    expect(decoded.role).toBe('ORG_ADMIN')
  })

  it('throws 401 for unknown token', async () => {
    await expect(refreshSession('unknown-uuid-token')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 after logout', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    await logout(refreshToken)

    await expect(refreshSession(refreshToken)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('logout', () => {
  it('removes refresh token from Redis', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    await logout(refreshToken)

    const stored = await redis.get(`refresh:${refreshToken}`)
    expect(stored).toBeNull()
  })
})
