import { describe, it, expect } from 'vitest'
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateById,
  createAssignment,
  deleteAssignment,
} from './recurring-templates.service'
import {
  createTestOrg,
  createTestPlan,
  createTestDepartment,
  createTestClient,
  createTestBoard,
  createTestColumn,
} from '@/test/helpers'

describe('createTemplate', () => {
  it('cria template com as duas listas de documento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)

    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'Folha de pagamento',
      periodicity: 'MONTHLY',
      dueMonthOffset: 1,
      dueDayOfPeriod: 15,
      dueRollToBusinessDay: false,
      targetOffsetDays: -2,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [{ name: 'Ponto' }],
      documentDeliveries: [{ name: 'Resumo da folha' }, { name: 'Recibos' }],
    })

    expect(template.documentRequests).toHaveLength(1)
    expect(template.documentDeliveries).toHaveLength(2)
  })

  it('lança 404 se departmentId pertence a outra organização', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const deptOfB = await createTestDepartment(orgB.id)

    await expect(
      createTemplate(orgA.id, {
        departmentId: deptOfB.id,
        title: 'X',
        periodicity: 'MONTHLY',
        dueMonthOffset: 0,
        dueDayOfPeriod: 10,
        dueRollToBusinessDay: false,
        targetOffsetDays: 0,
        targetRollToBusinessDay: false,
        generationMonthOffset: 1,
        generationDayOfPeriod: 5,
        autoCompleteOnAllActivitiesDone: false,
        notifyViaWhatsapp: true,
        notifyViaEmail: false,
        visibleToClient: true,
        isActive: true,
        documentRequests: [],
        documentDeliveries: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 400 se periodicidade semanal com dueDayOfPeriod > 7', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)

    await expect(
      createTemplate(org.id, {
        departmentId: dept.id,
        title: 'X',
        periodicity: 'WEEKLY',
        dueMonthOffset: 0,
        dueDayOfPeriod: 10,
        dueRollToBusinessDay: false,
        targetOffsetDays: 0,
        targetRollToBusinessDay: false,
        generationMonthOffset: 1,
        generationDayOfPeriod: 20,
        autoCompleteOnAllActivitiesDone: false,
        notifyViaWhatsapp: true,
        notifyViaEmail: false,
        visibleToClient: true,
        isActive: true,
        documentRequests: [],
        documentDeliveries: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('updateTemplate', () => {
  it('substitui a lista de documentos inteira (delete-then-create), sem acumular', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [{ name: 'A' }],
      documentDeliveries: [],
    })

    const updated = await updateTemplate(template.id, org.id, { documentRequests: [{ name: 'B' }, { name: 'C' }] })

    expect(updated.documentRequests.map((d) => d.name)).toEqual(['B', 'C'])
  })
})

describe('createAssignment', () => {
  it('vincula cliente a template com board/coluna válidos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [],
      documentDeliveries: [],
    })

    const assignment = await createAssignment(template.id, org.id, {
      clientId: client.id,
      boardId: board.id,
      columnId: col.id,
    })

    expect(assignment.clientId).toBe(client.id)
  })

  it('lança 409 ao vincular o mesmo cliente duas vezes ao mesmo template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [],
      documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await expect(
      createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 404 se o board não pertence ao cliente informado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const boardOfB = await createTestBoard(org.id, clientB.id)
    const col = await createTestColumn(boardOfB.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [],
      documentDeliveries: [],
    })

    await expect(
      createAssignment(template.id, org.id, { clientId: clientA.id, boardId: boardOfB.id, columnId: col.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteTemplate (com assignment vinculado)', () => {
  it('lança 409 quando o template tem assignment vinculado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [],
      documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await expect(deleteTemplate(template.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})
