import { describe, it, expect, vi, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })

describe('tentativas de login por conta', () => {
  it('after too many wrong passwords the account answers 429 for a while, even with the right one; other accounts are not affected', async () => {
    vi.stubEnv('RATE_LIMIT_LOGIN_MAX', '3')
    const org = await createTestOrg((await createTestPlan()).id)
    const target = await createTestUser(org.id)
    const other = await createTestUser(org.id)
    for (let i = 0; i < 3; i++) expect((await login(target.email, 'errada')).statusCode).toBe(401)
    const blocked = await login(target.email, 'Test@1234')
    expect(blocked.statusCode).toBe(429)
    expect(JSON.parse(blocked.body).message).toBe('Muitas tentativas de login. Tente de novo em alguns minutos.')
    expect((await login(other.email, 'Test@1234')).statusCode).toBe(200)
  })

  it('a successful login clears the failed attempts', async () => {
    vi.stubEnv('RATE_LIMIT_LOGIN_MAX', '3')
    const org = await createTestOrg((await createTestPlan()).id)
    const user = await createTestUser(org.id)
    for (let i = 0; i < 2; i++) await login(user.email, 'errada')
    expect((await login(user.email, 'Test@1234')).statusCode).toBe(200)
    for (let i = 0; i < 2; i++) expect((await login(user.email, 'errada')).statusCode).toBe(401)
  })

  it('an unknown e-mail costs the same password check as a real one (no timing hint that it does not exist)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    expect((await login(`ninguem-${Date.now()}@nada.com`, 'qualquer')).statusCode).toBe(401)
    expect(compare).toHaveBeenCalledTimes(1)
  })
})
