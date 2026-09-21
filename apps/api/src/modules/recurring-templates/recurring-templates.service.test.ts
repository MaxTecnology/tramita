import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateById,
  createAssignment,
  deleteAssignment,
  generateTaskForAssignment,
  generateManually,
} from './recurring-templates.service'
import {
  createTestOrg,
  createTestPlan,
  createTestDepartment,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestUser,
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

describe('generateTaskForAssignment', () => {
  async function setup() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Folha de pagamento', periodicity: 'MONTHLY',
      dueMonthOffset: 1, dueDayOfPeriod: 15, dueRollToBusinessDay: false,
      targetOffsetDays: -2, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [{ name: 'Resumo' }],
    })
    const assignment = await createAssignment(template.id, org.id, {
      clientId: client.id, boardId: board.id, columnId: col.id,
    })
    return { org, dept, client, board, col, template, assignment }
  }

  it('gera a tarefa com checklist copiado do template, dueDate/targetDate calculados e status BLOCKED (tem documento a cobrar)', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1)) // fevereiro
    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: outcome.taskId },
      include: { documentRequirements: true, deliverables: true },
    })
    expect(task.status).toBe('BLOCKED')
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-03-15')
    expect(task.documentRequirements).toHaveLength(1)
    expect(task.deliverables).toHaveLength(1)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_CREATED', channels: ['WHATSAPP'] }))

    spy.mockRestore()
  })

  it('falha ao enfileirar TASK_CREATED (ex.: blip do Redis) não reverte o SUCCESS nem reabre a idempotência', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const competence = new Date(Date.UTC(2026, 1, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

    // (a) a função continua retornando SUCCESS mesmo com a notificação falhando
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    // (b) o log de geração continua SUCCESS — não foi sobrescrito pra FAILED pelo catch genérico
    const log = await prisma.recurringGenerationLog.findUnique({
      where: { templateId_clientId_competence: { templateId: template.id, clientId: assignment.clientId, competence } },
    })
    expect(log?.status).toBe('SUCCESS')
    expect(log?.taskId).toBe(outcome.taskId)

    // (c) a chave de idempotência não foi reaberta — uma segunda tentativa continua bloqueada
    spy.mockResolvedValue()
    const second = await generateTaskForAssignment(template.id, assignment.id, competence)
    expect(second.status).toBe('ALREADY_EXISTS')

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    spy.mockRestore()
  })

  it('idempotência: chamar duas vezes pra mesma competência não cria segunda tarefa', async () => {
    const { template, assignment } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1))
    const first = await generateTaskForAssignment(template.id, assignment.id, competence)
    const second = await generateTaskForAssignment(template.id, assignment.id, competence)

    expect(first.status).toBe('SUCCESS')
    expect(second.status).toBe('ALREADY_EXISTS')

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    vi.restoreAllMocks()
  })

  it('isolamento de falha: coluna do vínculo não existe mais, grava FAILED e notifica ORG_ADMIN', async () => {
    const { org, template, assignment } = await setup()
    await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    // A coluna do vínculo tem onDelete: Cascade em RecurringTaskAssignment — apagar a coluna
    // de verdade apagaria o próprio vínculo junto (o assignment sairia com ela), e a função
    // retornaria cedo com "Vínculo não encontrado", nunca chegando no bloco try/catch que este
    // teste quer exercitar. Simula o mesmo sintoma ("coluna sumiu entre o fetch do vínculo e o
    // da coluna") sem violar a integridade referencial do banco. `vi.spyOn` não serve aqui:
    // o client do Prisma usa proxies internamente e `mockRestore()` deixa o método `undefined`
    // permanentemente pro resto do processo de teste (confirmado — quebrava os testes seguintes
    // do arquivo); por isso a troca/restauração é feita com atribuição direta de propriedade.
    const originalFindUnique = prisma.column.findUnique
    ;(prisma.column as unknown as { findUnique: typeof prisma.column.findUnique }).findUnique = (async () =>
      null) as unknown as typeof prisma.column.findUnique

    try {
      const competence = new Date(Date.UTC(2026, 1, 1))
      const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

      expect(outcome.status).toBe('FAILED')

      const log = await prisma.recurringGenerationLog.findUnique({
        where: { templateId_clientId_competence: { templateId: template.id, clientId: assignment.clientId, competence } },
      })
      expect(log?.status).toBe('FAILED')
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'RECURRING_GENERATION_FAILED' }))
    } finally {
      ;(prisma.column as unknown as { findUnique: typeof prisma.column.findUnique }).findUnique = originalFindUnique
      spy.mockRestore()
    }
  })

  it('reprocessamento manual: gera com sucesso depois de um FAILED anterior pra mesma competência', async () => {
    const { org, template, assignment, col } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1))
    await prisma.recurringGenerationLog.create({
      data: { templateId: template.id, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage: 'erro antigo' },
    })

    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)
    expect(outcome.status).toBe('SUCCESS')

    vi.restoreAllMocks()
  })
})

describe('generateManually', () => {
  async function setupTemplate() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    return { template, assignment }
  }

  it('lança 409 se já existe SUCCESS pra essa competência', async () => {
    const { template, assignment } = await setupTemplate()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date().toISOString()
    await generateManually(template.id, assignment.id, template.organizationId, competence)

    await expect(
      generateManually(template.id, assignment.id, template.organizationId, competence),
    ).rejects.toMatchObject({ statusCode: 409 })

    vi.restoreAllMocks()
  })
})
