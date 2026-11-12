import { describe, it, expect, vi, afterEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTemplate, updateTemplate, generateManually } from './recurring-templates.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestRecurringAssignment, getAuthHeader,
} from '@/test/helpers'

afterEach(() => vi.restoreAllMocks())

const base = {
  title: 'Apuração do Simples', periodicity: 'MONTHLY' as const, priority: 'MEDIUM' as const,
  competenceMonthOffset: 0, dueDayOfPeriod: 20, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE' as const,
  targetOffsetDays: 0, targetBusinessDayRoll: 'NONE' as const,
  generationMonthOffset: 1, generationDayOfPeriod: 5,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [],
}

describe('exige pagamento nas entregas', () => {
  it('copies requiresPayment from template deliveries to generated task deliverables', async () => {
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      ...base, departmentId: dept.id,
      documentDeliveries: [{ name: 'Guia DAS', requiresPayment: true }, { name: 'Extrato', requiresPayment: false }],
    })
    const assignment = await createTestRecurringAssignment(template.id, org.id, { clientId: client.id })

    const { taskId } = await generateManually(template.id, assignment.id, org.id, new Date().toISOString())

    const deliverables = await prisma.taskDeliverable.findMany({ where: { taskId: taskId! }, orderBy: { position: 'asc' } })
    expect(deliverables.map((d) => [d.name, d.requiresPayment])).toEqual([['Guia DAS', true], ['Extrato', false]])
  })

  it('update replaces deliveries keeping requiresPayment', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const template = await createTemplate(org.id, { ...base, departmentId: dept.id, documentDeliveries: [{ name: 'Guia', requiresPayment: false }] })

    const updated = await updateTemplate(template.id, org.id, { documentDeliveries: [{ name: 'Guia FGTS', requiresPayment: true }] })

    expect(updated.documentDeliveries.map((d) => [d.name, d.requiresPayment])).toEqual([['Guia FGTS', true]])
  })

  it('POST /tasks/:id/documents/deliveries accepts requiresPayment', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/documents/deliveries`,
      headers: { authorization: await getAuthHeader(admin.email, 'Test@1234') },
      payload: { name: 'Guia DARF', requiresPayment: true },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).requiresPayment).toBe(true)
  })
})
