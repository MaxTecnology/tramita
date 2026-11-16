import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, createTestClientUser, grantClientAccess, getAuthHeader } from '@/test/helpers'
import { clientTaskLink } from '@/modules/inbox/inbox-events'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, dept.id, admin.id)
  const { clientUser, password } = await createTestClientUser(org.id)
  await grantClientAccess(clientUser.id, client.id, dept.id)
  const model = await prisma.oSModel.create({
    data: { organizationId: org.id, departmentId: dept.id, name: 'Certidão', usableStandalone: true, documentRequests: { create: [{ name: 'Contrato social', position: 0 }] } },
  })
  const staff = await getAuthHeader(admin.email, 'Test@1234')
  const os = JSON.parse((await app.inject({ method: 'POST', url: '/os', headers: { authorization: staff }, payload: { osModelId: model.id, clientId: client.id } })).body) as { id: string }
  return { client, os, portal: await getAuthHeader(clientUser.email, password) }
}

describe('OS avulsa no portal', () => {
  it('appears in "Enviar documentos" of its opening month and the client link goes there', async () => {
    const c = await setup()
    const task = await prisma.task.findUniqueOrThrow({ where: { id: c.os.id }, include: { column: { include: { board: true } } } })
    const month = task.competence?.toISOString().slice(0, 7)
    expect(month).toBe(new Date().toISOString().slice(0, 7))
    expect(task.title).toBe('Certidão')
    const res = await app.inject({ method: 'GET', url: `/portal/document-requests?clientId=${c.client.id}&competence=${month}`, headers: { authorization: c.portal } })
    expect(JSON.stringify(JSON.parse(res.body))).toContain('Contrato social')
    expect(clientTaskLink({ id: task.id, boardId: task.column.boardId, boardType: task.column.board.type, competence: task.competence })).toBe(`/portal/send?competence=${month}&task=${task.id}`)
  })
})

describe('portal não vê dado interno do processo', () => {
  it('a client board has no delay reasons, office clock or names of internal OS', async () => {
    const c = await setup()
    const staffUser = await prisma.user.findFirstOrThrow({ where: { organizationId: c.client.organizationId, role: 'ORG_ADMIN' } })
    const staff = await getAuthHeader(staffUser.email, 'Test@1234')
    const dept = await prisma.department.findFirstOrThrow({ where: { organizationId: c.client.organizationId } })
    const model = await prisma.oSModel.create({ data: { organizationId: c.client.organizationId, departmentId: dept.id, name: 'Conferência interna', usableInProcess: true, visibleToClient: false, deadlineBusinessDays: 2 } })
    const visible = await prisma.oSModel.create({ data: { organizationId: c.client.organizationId, departmentId: dept.id, name: 'Registro', usableInProcess: true, deadlineBusinessDays: 2 } })
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: staff }, payload: { name: 'P', deadlineBusinessDays: 10, columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }], items: [{ osModelId: model.id, columnIndex: 0, dependsOn: [] }, { osModelId: visible.id, columnIndex: 0, dependsOn: [0] }] } })).body)
    const board = JSON.parse((await app.inject({ method: 'POST', url: '/boards', headers: { authorization: staff }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })).body)
    await prisma.task.updateMany({ where: { column: { boardId: board.id } }, data: { delayNote: 'erro do analista' } })
    await prisma.board.update({ where: { id: board.id }, data: { delayNote: 'erro do analista' } })
    for (const url of [`/boards/${board.id}`, '/boards']) {
      const body = (await app.inject({ method: 'GET', url, headers: { authorization: c.portal } })).body
      for (const internal of ['erro do analista', 'delayReasonId', 'delayReasonPending', 'deadlineBusinessDays', 'officeBusinessDays', 'waitingFor', 'Conferência interna']) {
        expect(body, `${url} has ${internal}`).not.toContain(internal)
      }
    }
  })
})
