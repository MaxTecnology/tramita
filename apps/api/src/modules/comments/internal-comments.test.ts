import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment,
  createTestClientUser, grantClientAccess, createTestBoard, createTestColumn, createTestTask, getAuthHeader,
} from '@/test/helpers'
import { listDocumentRequestsByMonth } from '@/modules/portal/portal-overview.service'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const department = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, department.id, admin.id)
  const { clientUser, password } = await createTestClientUser(org.id)
  await grantClientAccess(clientUser.id, client.id, department.id)
  // A services board: the portal "Enviar documentos" lists tasks of system boards
  const board = await createTestBoard(org.id, client.id)
  await prisma.board.update({ where: { id: board.id }, data: { type: 'SERVICE_SYSTEM' } })
  const col = await createTestColumn(board.id, { position: 0 })
  const task = await createTestTask(col.id, admin.id, { departmentId: department.id })
  await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: true, competence: new Date('2026-11-01T00:00:00.000Z') } })
  return {
    org, client, clientUser, task,
    staffAuth: await getAuthHeader(admin.email, 'Test@1234'),
    clientAuth: await getAuthHeader(clientUser.email, password),
  }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const comment = (c: Ctx, auth: string, payload: object) =>
  app.inject({ method: 'POST', url: `/tasks/${c.task.id}/comments`, headers: { authorization: auth }, payload })
const list = async (c: Ctx, auth: string) =>
  JSON.parse((await app.inject({ method: 'GET', url: `/tasks/${c.task.id}/comments`, headers: { authorization: auth } })).body) as { id: string; content: string; isInternal: boolean }[]

describe('comentário interno', () => {
  it('the office sees it marked as internal; the client never sees it', async () => {
    const c = await setup()
    await comment(c, c.staffAuth, { content: 'Cliente atrasou, cobrar amanhã', isInternal: true })
    await comment(c, c.staffAuth, { content: 'Recebemos, obrigado' })
    expect((await list(c, c.staffAuth)).map((x) => [x.content, x.isInternal])).toEqual([['Cliente atrasou, cobrar amanhã', true], ['Recebemos, obrigado', false]])
    expect((await list(c, c.clientAuth)).map((x) => x.content)).toEqual(['Recebemos, obrigado'])
  })

  it('an internal comment does not reach the client: no WhatsApp/e-mail and no bell', async () => {
    const c = await setup()
    await comment(c, c.staffAuth, { content: 'nota interna', isInternal: true })
    expect(queue.enqueueNotification).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_COMMENT_ADDED', clientId: c.client.id }))
    expect(await prisma.inAppNotification.count({ where: { recipientClientUserId: c.clientUser.id } })).toBe(0)
  })

  it('the client cannot delete it (to the client it does not exist) nor write one', async () => {
    const c = await setup()
    const internal = JSON.parse((await comment(c, c.staffAuth, { content: 'nota interna', isInternal: true })).body) as { id: string }
    const del = await app.inject({ method: 'DELETE', url: `/comments/${internal.id}`, headers: { authorization: c.clientAuth } })
    expect(del.statusCode).toBe(404)
    const own = JSON.parse((await comment(c, c.clientAuth, { content: 'segue o extrato', isInternal: true })).body) as { isInternal: boolean }
    expect(own.isInternal).toBe(false)
  })

  it('a task with only internal talk does not show up in the client "Enviar documentos" list', async () => {
    const c = await setup()
    await comment(c, c.staffAuth, { content: 'nota interna', isInternal: true })
    const month = await listDocumentRequestsByMonth(c.org.id, c.client.id, c.clientUser.id, '2026-11')
    expect(month.tasks.map((t: { taskId: string }) => t.taskId)).not.toContain(c.task.id)
  })

  it('(control) the same task with a normal comment does show up', async () => {
    const c = await setup()
    await comment(c, c.staffAuth, { content: 'Recebemos' })
    const month = await listDocumentRequestsByMonth(c.org.id, c.client.id, c.clientUser.id, '2026-11')
    expect(month.tasks.map((t: { taskId: string }) => t.taskId)).toContain(c.task.id)
  })
})
