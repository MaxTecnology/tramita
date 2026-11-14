import { describe, it, expect, vi, afterEach } from 'vitest'
import { app } from '@/test/setup'
import { redis } from '@/lib/redis'
import { notifyInApp } from './inbox.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClientUser, getAuthHeader } from '@/test/helpers'

afterEach(() => vi.restoreAllMocks())

describe('sino em tempo real', () => {
  it('a new notification is published to each recipient channel', async () => {
    const publish = vi.spyOn(redis, 'publish').mockResolvedValue(0)
    const org = await createTestOrg((await createTestPlan()).id)
    const carla = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { clientUser } = await createTestClientUser(org.id)
    await notifyInApp({
      organizationId: org.id, type: 'TASK_COMMENT', title: 't', body: 'b', link: '/x',
      to: { userIds: [carla.id], clientUserIds: [clientUser.id] },
    })
    const channels = publish.mock.calls.map(([ch]) => ch)
    expect(channels).toContain(`inbox:user:${carla.id}`)
    expect(channels).toContain(`inbox:client:${clientUser.id}`)
    expect(publish).toHaveBeenCalledWith(`inbox:user:${carla.id}`, expect.stringContaining('"inbox:changed"'))
  })

  it('reading in one tab tells the other tabs of the same person', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const carla = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const publish = vi.spyOn(redis, 'publish').mockResolvedValue(0)
    await app.inject({ method: 'POST', url: '/notifications/read-all', headers: { authorization: await getAuthHeader(carla.email, 'Test@1234') } })
    expect(publish).toHaveBeenCalledWith(`inbox:user:${carla.id}`, expect.stringContaining('"inbox:changed"'))
  })

  it('GET /notifications/stream needs a valid ticket and an organization', async () => {
    expect((await app.inject({ method: 'GET', url: '/notifications/stream' })).statusCode).toBe(401)
    const { issueStreamTicket } = await import('@/modules/stream/stream-ticket')
    const ticket = await issueStreamTicket({ sub: 'master-id', role: 'MASTER', organizationId: null })
    expect((await app.inject({ method: 'GET', url: `/notifications/stream?ticket=${ticket}` })).statusCode).toBe(403)
  })
})
