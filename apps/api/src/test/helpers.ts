import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import type { LoginResponse } from '@/modules/auth/auth.types'

export async function createTestPlan(overrides?: Partial<{ name: string; maxClients: number }>) {
  return prisma.plan.create({
    data: {
      name: overrides?.name ?? 'Test Plan',
      maxClients: overrides?.maxClients ?? 50,
      priceMonthly: 197.0,
      features: { pdf: true, sse: true, attachments: true },
      isActive: true,
    },
  })
}

export async function createTestOrg(planId: string, overrides?: Partial<{ slug: string }>) {
  const unique = Date.now()
  return prisma.organization.create({
    data: {
      name: 'Test Org',
      slug: overrides?.slug ?? `test-org-${unique}`,
      email: `org-${unique}@test.com`,
      planId,
      subscriptionStatus: 'ACTIVE',
    },
  })
}

export async function createTestUser(
  organizationId: string,
  overrides?: Partial<{
    role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
    email: string
    password: string
  }>,
) {
  const password = overrides?.password ?? 'Test@1234'
  return prisma.user.create({
    data: {
      name: 'Test User',
      email: overrides?.email ?? `user-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: overrides?.role ?? 'ORG_ADMIN',
      organizationId,
    },
  })
}

export async function createTestClient(organizationId: string) {
  return prisma.client.create({
    data: {
      name: 'Test Client',
      email: `client-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash('Client@1234', 10),
      organizationId,
    },
  })
}

export async function loginAs(email: string, password: string): Promise<LoginResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  })
  return JSON.parse(response.body) as LoginResponse
}
