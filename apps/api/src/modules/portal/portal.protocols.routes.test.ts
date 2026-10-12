// apps/api/src/modules/portal/portal.protocols.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard,
  createTestColumn, createTestTask, createTestDepartment, createTestClientUser,
  grantClientAccess, getAuthHeader,
} from '@/test/helpers'

async function setupProtocol(orgId: string, staffId: string) {
  const client = await createTestClient(orgId)
  const department = await createTestDepartment(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, staffId, { departmentId: department.id })
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: staffId },
  })
  const auth = await getAuthHeader((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).email, 'Test@1234')
  const created = await app.inject({
    method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
    payload: { title: 'Guia', attachmentId: attachment.id },
  })
  return { client, department, protocol: JSON.parse(created.body) }
}

describe('GET /portal/protocols/:id', () => {
  it('registra VIEWED com o IP real do cliente (via X-Forwarded-For, graças ao trustProxy)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET',
      url: `/portal/protocols/${protocol.id}`,
      headers: { authorization: authClient, 'x-forwarded-for': '203.0.113.9' },
    })

    expect(res.statusCode).toBe(200)
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(event?.ip).toBe('203.0.113.9')
  })

  it('ClientUser sem acesso à empresa recebe 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id) // sem grantClientAccess
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols/${protocol.id}`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /portal/protocols/:id/download', () => {
  it('registra DOWNLOADED e devolve uma url', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols/${protocol.id}/download`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).url).toBeTruthy()
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: protocol.id, type: 'DOWNLOADED' } })
    expect(event).not.toBeNull()
  })
})

describe('GET /portal/protocols', () => {
  it('lista os protocolos da empresa do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols?clientId=${client.id}`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})
