import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestRequest, getAuthHeader,
} from '@/test/helpers'

// A manager of a department that does not serve the client acts on nothing of that client
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const contabil = await createTestDepartment(org.id, { name: 'Contábil' })
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, fiscal.id, admin.id)
  const outsider = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [contabil.id] })
  const col = await createTestColumn((await createTestBoard(org.id, client.id)).id, { position: 0 })
  const task = await createTestTask(col.id, admin.id, { departmentId: fiscal.id })
  return { org, admin, fiscal, client, task, adminAuth: await getAuthHeader(admin.email, 'Test@1234'), outsiderAuth: await getAuthHeader(outsider.email, 'Test@1234') }
}

describe('escopo e assinatura nas rotas que faltavam', () => {
  it('a manager outside the client cannot delete a comment of its request', async () => {
    const c = await setup()
    const request = await createTestRequest(c.org.id, c.client.id, { title: 'Pedido', departmentId: c.fiscal.id })
    const comment = await prisma.requestComment.create({ data: { requestId: request.id, content: 'interno', authorType: 'USER', userId: c.admin.id } })
    const res = await app.inject({ method: 'DELETE', url: `/request-comments/${comment.id}`, headers: { authorization: c.outsiderAuth } })
    expect(res.statusCode).toBe(404)
    expect((await prisma.requestComment.findUniqueOrThrow({ where: { id: comment.id } })).deletedAt).toBeNull()
  })

  it('a manager outside the process cannot release its OS early', async () => {
    const c = await setup()
    const model = await prisma.oSModel.create({ data: { organizationId: c.org.id, departmentId: c.fiscal.id, name: 'Alvará', usableInProcess: true } })
    await prisma.task.update({ where: { id: c.task.id }, data: { osModelId: model.id, releasedAt: null } })
    const res = await app.inject({ method: 'POST', url: `/tasks/${c.task.id}/release`, headers: { authorization: c.outsiderAuth }, payload: { reason: 'furar a fila' } })
    expect(res.statusCode).toBe(404)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).releasedAt).toBeNull()
  })

  it('a suspended office cannot comment (like every other change)', async () => {
    const c = await setup()
    await prisma.organization.update({ where: { id: c.org.id }, data: { subscriptionStatus: 'SUSPENDED' } })
    const res = await app.inject({ method: 'POST', url: `/tasks/${c.task.id}/comments`, headers: { authorization: c.adminAuth }, payload: { content: 'oi' } })
    expect(res.statusCode).toBe(403)
  })
})
