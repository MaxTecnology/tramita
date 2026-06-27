import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import { createRequest, listRequestsForOrg, listRequestsForClient, getRequestById, cancelRequest } from './requests.service'

vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue')
  return { ...actual, enqueueNotification: vi.fn() }
})

describe('createRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cria a request como PENDING e enfileira REQUEST_CREATED para cada ORG_ADMIN/ORG_MANAGER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    await createTestUser(org.id, { role: 'ORG_MEMBER' }) // não deve ser notificado
    const client = await createTestClient(org.id)

    const request = await createRequest(org.id, client.id, { title: 'Abertura de LTDA' })

    expect(request.status).toBe('PENDING')
    expect(request.clientId).toBe(client.id)

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(2)
    const calledUserIds = vi.mocked(queue.enqueueNotification).mock.calls.map((c) => c[0].userId)
    expect(calledUserIds).toContain(admin.id)
    expect(calledUserIds).toContain(manager.id)
  })

  it('lança 404 se o cliente não pertence à org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const otherOrg = await createTestOrg(plan.id, { slug: 'other-org' })
    const client = await createTestClient(otherOrg.id)

    await expect(createRequest(org.id, client.id, { title: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('listRequestsForOrg / listRequestsForClient / getRequestById', () => {
  it('lista requests da org e filtra por status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    await createRequest(org.id, client.id, { title: 'Pedido 1' })
    const r2 = await createRequest(org.id, client.id, { title: 'Pedido 2' })
    await cancelRequest(r2.id, org.id, client.id)

    const all = await listRequestsForOrg(org.id)
    expect(all).toHaveLength(2)

    const onlyCancelled = await listRequestsForOrg(org.id, 'CANCELLED')
    expect(onlyCancelled).toHaveLength(1)
    expect(onlyCancelled[0].title).toBe('Pedido 2')
  })

  it('cliente só vê as próprias requests', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b@test.com' })
    await createRequest(org.id, clientA.id, { title: 'Da A' })
    await createRequest(org.id, clientB.id, { title: 'Da B' })

    const result = await listRequestsForClient(org.id, clientA.id)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Da A')
  })

  it('getRequestById lança 404 quando clientId não é o dono', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a2@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b2@test.com' })
    const request = await createRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(getRequestById(request.id, org.id, clientB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('cancelRequest', () => {
  it('cancela uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const cancelled = await cancelRequest(request.id, org.id, client.id)
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('lança 422 ao tentar cancelar uma request já cancelada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await cancelRequest(request.id, org.id, client.id)

    await expect(cancelRequest(request.id, org.id, client.id)).rejects.toMatchObject({ statusCode: 422 })
  })
})
