// apps/api/src/modules/protocols/protocols.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard,
  createTestColumn, createTestTask, createTestClientUser, getAuthHeader,
} from '@/test/helpers'

async function setupTaskWithAttachment(orgId: string, userId: string) {
  const client = await createTestClient(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, userId)
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: userId },
  })
  return { task, attachment }
}

describe('POST /tasks/:taskId/protocols', () => {
  it('ORG_MEMBER cria protocolo com anexo existente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, member.id)
    const auth = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia DARF', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).status).toBe('SENT')
  })

  it('CLIENT não pode criar protocolo (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, member.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: authClient },
      payload: { title: 'x', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(403)
  })

  it('sem header de autorização recebe 401', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`,
      payload: { title: 'x', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /protocols e /protocols/summary', () => {
  it('lista e resume os protocolos da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia', attachmentId: attachment.id },
    })

    const list = await app.inject({ method: 'GET', url: '/protocols', headers: { authorization: auth } })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toHaveLength(1)

    const summary = await app.inject({ method: 'GET', url: '/protocols/summary', headers: { authorization: auth } })
    expect(summary.statusCode).toBe(200)
    expect(JSON.parse(summary.body).SENT).toBe(1)
  })
})

describe('GET /protocols/:id/receipt', () => {
  it('devolve HTML com o número do protocolo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const created = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia', attachmentId: attachment.id },
    })
    const protocol = JSON.parse(created.body)

    const res = await app.inject({ method: 'GET', url: `/protocols/${protocol.id}/receipt`, headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain(protocol.number)
  })
})
