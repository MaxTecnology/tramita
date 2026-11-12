import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { createTemplate, generateManually } from '@/modules/recurring-templates/recurring-templates.service'
import { insertProtocol } from '@/modules/protocols/protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestClientUser, grantClientAccess,
  createTestRecurringAssignment, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

const templateBase = {
  periodicity: 'MONTHLY' as const, priority: 'MEDIUM' as const,
  competenceMonthOffset: 0, dueDayOfPeriod: 20, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE' as const,
  targetOffsetDays: 0, targetBusinessDayRoll: 'NONE' as const, generationMonthOffset: 1, generationDayOfPeriod: 5,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentDeliveries: [],
}

// Client with Fiscal (recurring "Apuração" asking for "Extrato" in 2026-10) and Folha (recurring
// asking for "Ponto"); an OS process with its own document request; one unpaid Fiscal guide.
async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const client = await createTestClient(org.id)

  const mk = async (deptId: string, title: string, doc: string) => {
    const t = await createTemplate(org.id, { ...templateBase, departmentId: deptId, title, documentRequests: [{ name: doc }] })
    const a = await createTestRecurringAssignment(t.id, org.id, { clientId: client.id })
    const { taskId } = await generateManually(t.id, a.id, org.id, '2026-11-01T00:00:00.000Z')
    return prisma.task.findUniqueOrThrow({ where: { id: taskId! }, include: { documentRequirements: true } })
  }
  const fiscalTask = await mk(fiscal.id, 'Apuração', 'Extrato')
  const folhaTask = await mk(folha.id, 'Folha mensal', 'Ponto')

  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const osTask = await createTestTask(column.id, admin.id, { departmentId: fiscal.id })
  await prisma.task.update({ where: { id: osTask.id }, data: { visibleToClient: true } })
  await prisma.taskDocumentRequirement.create({ data: { taskId: osTask.id, name: 'Contrato social', position: 0 } })

  await insertProtocol({
    organizationId: org.id, clientId: client.id, taskId: fiscalTask.id, title: 'Guia DAS', content: 'x',
    createdById: admin.id, requiresPayment: true, amount: '100.00', dueDate: new Date(Date.now() + 2 * 86400000),
  })

  const { clientUser: fiscalUser, password } = await createTestClientUser(org.id)
  await grantClientAccess(fiscalUser.id, client.id, fiscal.id)
  const { clientUser: folhaUser, password: p2 } = await createTestClientUser(org.id)
  await grantClientAccess(folhaUser.id, client.id, folha.id)

  return {
    org, admin, client, fiscalTask, folhaTask, osTask,
    fiscalAuth: await clientLogin(fiscalUser.email, password),
    folhaAuth: await clientLogin(folhaUser.email, p2),
    adminAuth: await getAuthHeader(admin.email, 'Test@1234'),
  }
}

describe('portal — início e enviar documentos', () => {
  it('home counts unpaid guides, documents to send and processes in progress within the user scope', async () => {
    const { client, fiscalAuth, folhaAuth } = await setup()

    const fiscal = JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${client.id}`, headers: { authorization: fiscalAuth } })).body)
    const folha = JSON.parse((await app.inject({ method: 'GET', url: `/portal/home?clientId=${client.id}`, headers: { authorization: folhaAuth } })).body)

    expect(fiscal.unpaidGuides).toEqual({ count: 1, overdueCount: 0 })
    expect(fiscal.documentsToSend).toBe(2) // Extrato (recorrente) + Contrato social (processo)
    expect(fiscal.processesInProgress).toBe(1)
    expect(fiscal.dueThisWeek.map((i: { kind: string; title: string }) => [i.kind, i.title])).toContainEqual(['guide', 'Guia DAS'])

    expect(folha.unpaidGuides).toEqual({ count: 0, overdueCount: 0 })
    expect(folha.documentsToSend).toBe(1) // só Ponto
    expect(folha.processesInProgress).toBe(0)
  })

  it('document requests by month list only recurring tasks of that competence', async () => {
    const { client, fiscalTask, fiscalAuth } = await setup()
    const competence = fiscalTask.competence!.toISOString().slice(0, 7)

    const res = await app.inject({ method: 'GET', url: `/portal/document-requests?clientId=${client.id}&competence=${competence}`, headers: { authorization: fiscalAuth } })
    const months = await app.inject({ method: 'GET', url: `/portal/document-requests/months?clientId=${client.id}`, headers: { authorization: fiscalAuth } })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.requests.map((r: { name: string; departmentName: string }) => [r.name, r.departmentName])).toEqual([['Extrato', 'Fiscal']])
    expect(JSON.parse(months.body)).toEqual([{ competence, pending: 1, total: 1 }])
  })

  it('not applicable unblocks the task like an approval and can be undone while not done', async () => {
    const { fiscalTask, fiscalAuth } = await setup()
    const req = fiscalTask.documentRequirements[0]
    expect(fiscalTask.status).toBe('BLOCKED')
    const url = `/portal/tasks/${fiscalTask.id}/documents/requests/${req.id}/not-applicable`

    const set = await app.inject({ method: 'POST', url, headers: { authorization: fiscalAuth } })
    expect(set.statusCode).toBe(200)
    expect((await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('NOT_APPLICABLE')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: fiscalTask.id } })).status).toBe('OPEN')

    const undo = await app.inject({ method: 'DELETE', url, headers: { authorization: fiscalAuth } })
    expect(undo.statusCode).toBe(200)
    expect((await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: fiscalTask.id } })).status).toBe('BLOCKED')
  })

  it('undo is refused once the task is done', async () => {
    const { fiscalTask, fiscalAuth } = await setup()
    const req = fiscalTask.documentRequirements[0]
    const url = `/portal/tasks/${fiscalTask.id}/documents/requests/${req.id}/not-applicable`
    await app.inject({ method: 'POST', url, headers: { authorization: fiscalAuth } })
    await prisma.task.update({ where: { id: fiscalTask.id }, data: { status: 'DONE' } })

    const undo = await app.inject({ method: 'DELETE', url, headers: { authorization: fiscalAuth } })

    expect(undo.statusCode).toBe(409)
    expect(JSON.parse(undo.body).message).toBe('A tarefa já foi concluída')
  })

  it('office can reject a not applicable with a reason', async () => {
    const { fiscalTask, fiscalAuth, adminAuth } = await setup()
    const req = fiscalTask.documentRequirements[0]
    await app.inject({ method: 'POST', url: `/portal/tasks/${fiscalTask.id}/documents/requests/${req.id}/not-applicable`, headers: { authorization: fiscalAuth } })

    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${fiscalTask.id}/documents/requests/${req.id}`,
      headers: { authorization: adminAuth }, payload: { decision: 'REJECTED', rejectionReason: 'Teve movimentação no mês' },
    })

    expect(res.statusCode).toBe(200)
    const after = await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: req.id } })
    expect([after.status, after.rejectionReason]).toEqual(['REJECTED', 'Teve movimentação no mês'])
  })

  it('Folha-only user gets 404 on not-applicable of a Fiscal request', async () => {
    const { fiscalTask, folhaAuth } = await setup()
    const req = fiscalTask.documentRequirements[0]

    const res = await app.inject({ method: 'POST', url: `/portal/tasks/${fiscalTask.id}/documents/requests/${req.id}/not-applicable`, headers: { authorization: folhaAuth } })

    expect(res.statusCode).toBe(404)
    expect((await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING')
  })
})
