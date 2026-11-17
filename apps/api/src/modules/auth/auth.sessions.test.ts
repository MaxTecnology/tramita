import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/jwt'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, createTestClientUser } from '@/test/helpers'
import { deleteUser, updateUser, resetUserPassword } from '@/modules/users/users.service'
import { updateClientUser, deleteClientUser } from '@/modules/client-users/client-users.service'

const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
const refresh = (refreshToken: string) => app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })
const session = async (email: string, password = 'Test@1234') => JSON.parse((await login(email, password)).body) as { accessToken: string; refreshToken: string }

async function office() {
  const org = await createTestOrg((await createTestPlan()).id)
  const member = await createTestUser(org.id, { role: 'ORG_MANAGER' })
  return { org, member }
}

describe('sessão de quem foi desativado, rebaixado ou teve a senha trocada', () => {
  it('a deactivated staff member cannot log in', async () => {
    const { member } = await office()
    await prisma.user.update({ where: { id: member.id }, data: { isActive: false } })
    expect((await login(member.email, 'Test@1234')).statusCode).toBe(401)
  })

  it('deactivating a staff member ends the sessions already open', async () => {
    const { org, member } = await office()
    const s = await session(member.email)
    await deleteUser(member.id, org.id)
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
  })

  it('a staff member deactivated straight in the database cannot refresh either', async () => {
    const { member } = await office()
    const s = await session(member.email)
    await prisma.user.update({ where: { id: member.id }, data: { isActive: false } })
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
  })

  it('a demoted manager loses the old role: the session ends and the next one carries the new role', async () => {
    const { org, member } = await office()
    const s = await session(member.email)
    await updateUser(member.id, org.id, { role: 'ORG_MEMBER' })
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
    const again = await session(member.email)
    expect(verifyAccessToken(again.accessToken).role).toBe('ORG_MEMBER')
  })

  it('the refreshed token always carries the role saved in the database', async () => {
    const { member } = await office()
    const s = await session(member.email)
    await prisma.user.update({ where: { id: member.id }, data: { role: 'ORG_MEMBER' } })
    const res = await refresh(s.refreshToken)
    expect(res.statusCode).toBe(200)
    expect(verifyAccessToken(JSON.parse(res.body).accessToken).role).toBe('ORG_MEMBER')
  })

  it('a password reset by the admin ends the open sessions', async () => {
    const { org, member } = await office()
    const s = await session(member.email)
    await resetUserPassword(member.id, org.id)
    expect((await refresh(s.refreshToken)).statusCode).toBe(401)
  })

  it('changing my own password ends my other sessions and keeps the one I am using', async () => {
    const { member } = await office()
    const here = await session(member.email)
    const elsewhere = await session(member.email)
    const res = await app.inject({
      method: 'POST', url: '/auth/change-password', headers: { authorization: `Bearer ${here.accessToken}` },
      payload: { currentPassword: 'Test@1234', newPassword: 'Nova@12345', keepRefreshToken: here.refreshToken },
    })
    expect(res.statusCode).toBe(204)
    expect((await refresh(elsewhere.refreshToken)).statusCode).toBe(401)
    expect((await refresh(here.refreshToken)).statusCode).toBe(200)
  })

  it('a portal user deactivated or with a new password set by the office loses the open sessions', async () => {
    const { org } = await office()
    const a = await createTestClientUser(org.id)
    const sa = await session(a.clientUser.email, a.password)
    await updateClientUser(a.clientUser.id, org.id, { password: 'Outra@12345' })
    expect((await refresh(sa.refreshToken)).statusCode).toBe(401)

    const b = await createTestClientUser(org.id)
    const sb = await session(b.clientUser.email, b.password)
    await deleteClientUser(b.clientUser.id, org.id)
    expect((await refresh(sb.refreshToken)).statusCode).toBe(401)
  })

  it('logging out removes only that session', async () => {
    const { member } = await office()
    const one = await session(member.email)
    const two = await session(member.email)
    await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: one.refreshToken } })
    expect((await refresh(one.refreshToken)).statusCode).toBe(401)
    expect((await refresh(two.refreshToken)).statusCode).toBe(200)
  })
})
