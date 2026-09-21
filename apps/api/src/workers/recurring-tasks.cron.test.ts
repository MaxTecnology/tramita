import { describe, it, expect, vi } from 'vitest'
import * as queue from '@/lib/queue'
import { runRecurringTasksGeneration } from './recurring-tasks.cron'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestDepartment,
  createTestClient, createTestBoard, createTestColumn,
} from '@/test/helpers'
import { createTemplate } from '@/modules/recurring-templates/recurring-templates.service'
import { createAssignment } from '@/modules/recurring-templates/recurring-templates.service'

describe('runRecurringTasksGeneration', () => {
  it('gera tarefa só pros templates cujo generationDayOfPeriod bate com a data informada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const templateTriggersToday = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Dispara hoje', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(templateTriggersToday.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    const templateDoesNotTrigger = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Não dispara hoje', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(templateDoesNotTrigger.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    const today = new Date(Date.UTC(2026, 0, 20)) // dia 20
    await runRecurringTasksGeneration(today)

    const tasksOfTriggered = await prisma.task.count({ where: { recurringTemplateId: templateTriggersToday.id } })
    const tasksOfNotTriggered = await prisma.task.count({ where: { recurringTemplateId: templateDoesNotTrigger.id } })
    expect(tasksOfTriggered).toBe(1)
    expect(tasksOfNotTriggered).toBe(0)

    vi.restoreAllMocks()
  })

  it('não gera nada pra template inativo (isActive=false)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Inativo', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: false, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await runRecurringTasksGeneration(new Date(Date.UTC(2026, 0, 20)))

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(0)

    vi.restoreAllMocks()
  })

  it('não gera nada pra assignment inativo (isActive=false), mesmo com o template ativo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    await prisma.recurringTaskAssignment.update({ where: { id: assignment.id }, data: { isActive: false } })

    await runRecurringTasksGeneration(new Date(Date.UTC(2026, 0, 20)))

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(0)

    vi.restoreAllMocks()
  })
})
