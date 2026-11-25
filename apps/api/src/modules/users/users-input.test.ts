import { describe, expect, it } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, getAuthHeader } from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const dept = await createTestDepartment(org.id)
  return { org, dept, auth: await getAuthHeader(admin.email, 'Test@1234') }
}
const create = (auth: string, body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/users', headers: { authorization: auth }, payload: body })

describe('cadastro de pessoas — entrada', () => {
  it('stores the e-mail in lower case, and the person signs in typing it either way', async () => {
    const s = await setup()
    const res = await create(s.auth, { name: 'Ana Souza', email: '  Ana.Souza@G2A.com.br ', role: 'ORG_MEMBER', departmentIds: [s.dept.id] })
    expect(res.statusCode).toBe(201)
    const { temporaryPassword } = res.json() as { temporaryPassword: string }
    expect((await prisma.user.findFirstOrThrow({ where: { organizationId: s.org.id, name: 'Ana Souza' } })).email).toBe('ana.souza@g2a.com.br')
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ANA.SOUZA@g2a.com.br', password: temporaryPassword } })
    expect(login.statusCode).toBe(200)
  })

  it('refuses names, e-mails and phones beyond a sane size', async () => {
    const s = await setup()
    const base = { name: 'Ana', email: 'ana@x.com', role: 'ORG_MEMBER', departmentIds: [s.dept.id] }
    expect((await create(s.auth, { ...base, name: 'A'.repeat(121) })).statusCode).toBe(400)
    expect((await create(s.auth, { ...base, email: `${'a'.repeat(250)}@x.com` })).statusCode).toBe(400)
    expect((await create(s.auth, { ...base, phone: '9'.repeat(31) })).statusCode).toBe(400)
  })
})
