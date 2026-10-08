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
  generateBulkForTemplate,
  generateBulkForAllTemplates,
  getFailedGenerations,
  regenerateTask,
  regenerateBulkForTemplate,
} from './recurring-templates.service'
import {
  createTestOrg,
  createTestPlan,
  createTestDepartment,
  createTestClient,
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
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 1,
      dueDayOfPeriod: 15, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: -2,
      targetBusinessDayRoll: 'NONE',
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
        periodicity: 'MONTHLY', priority: 'MEDIUM',
        competenceMonthOffset: 0,
        dueDayOfPeriod: 10, dueMonthAnchor: 1,
        dueBusinessDayRoll: 'NONE',
        targetOffsetDays: 0,
        targetBusinessDayRoll: 'NONE',
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
        periodicity: 'WEEKLY', priority: 'MEDIUM',
        competenceMonthOffset: 0,
        dueDayOfPeriod: 10, dueMonthAnchor: 1,
        dueBusinessDayRoll: 'NONE',
        targetOffsetDays: 0,
        targetBusinessDayRoll: 'NONE',
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
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0,
      dueDayOfPeriod: 10, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0,
      targetBusinessDayRoll: 'NONE',
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
  it('vincula cliente a template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0,
      dueDayOfPeriod: 10, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0,
      targetBusinessDayRoll: 'NONE',
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

    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })

    expect(assignment.clientId).toBe(client.id)
  })

  it('lança 409 ao vincular o mesmo cliente duas vezes ao mesmo template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0,
      dueDayOfPeriod: 10, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0,
      targetBusinessDayRoll: 'NONE',
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
    await createAssignment(template.id, org.id, { clientId: client.id })

    await expect(
      createAssignment(template.id, org.id, { clientId: client.id }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 404 se o cliente não pertence à organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientOfB = await createTestClient(orgB.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0,
      dueDayOfPeriod: 10, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0,
      targetBusinessDayRoll: 'NONE',
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
      createAssignment(template.id, org.id, { clientId: clientOfB.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteTemplate (com assignment vinculado)', () => {
  it('lança 409 quando o template tem assignment vinculado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0,
      dueDayOfPeriod: 10, dueMonthAnchor: 1,
      dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0,
      targetBusinessDayRoll: 'NONE',
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
    await createAssignment(template.id, org.id, { clientId: client.id })

    await expect(deleteTemplate(template.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('generateTaskForAssignment', () => {
  async function setup(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM') {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Folha de pagamento', periodicity: 'MONTHLY', priority,
      competenceMonthOffset: 1, dueDayOfPeriod: 15, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: -2, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [{ name: 'Resumo' }],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })
    return { org, dept, client, template, assignment }
  }

  it('gera a tarefa com checklist copiado do template, dueDate/targetDate calculados e status BLOCKED (tem documento a cobrar)', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    // dueMonth é o mês de vencimento (âncora): dueDayOfPeriod=15 → vence 15/março.
    // competenceMonthOffset=1 → competência derivada é fevereiro.
    const dueMonth = new Date(Date.UTC(2026, 2, 1)) // março
    const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: outcome.taskId },
      include: { documentRequirements: true, deliverables: true },
    })
    expect(task.status).toBe('BLOCKED')
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-03-15')
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2026-02-01')
    expect(task.documentRequirements).toHaveLength(1)
    expect(task.deliverables).toHaveLength(1)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_CREATED', channels: ['WHATSAPP'] }))

    spy.mockRestore()
  })

  it('gera a tarefa com a prioridade configurada no template, não com MEDIUM fixo', async () => {
    const { template, assignment } = await setup('URGENT')
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const outcome = await generateTaskForAssignment(template.id, assignment.id, new Date(Date.UTC(2026, 2, 1)))
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(task.priority).toBe('URGENT')

    spy.mockRestore()
  })

  it('DAS: dueMonth=outubro, dueDayOfPeriod=10, competenceMonthOffset=1 → vence 10/outubro, competência setembro', async () => {
    const { org, dept, client } = await setup()
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'DAS', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const dasAssignment = await createAssignment(template.id, org.id, { clientId: client.id })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)) // outubro
    const outcome = await generateTaskForAssignment(template.id, dasAssignment.id, dueMonth)
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-10')
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('gera com TASK_BLOCKED (exatamente uma vez) quando o template tem documento exigido', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
    expect(outcome.status).toBe('SUCCESS')

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(1)
    spy.mockRestore()
  })

  it('não gera TASK_BLOCKED quando o template não tem documento exigido (tarefa nasce OPEN)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Folha de pagamento', periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 1, dueDayOfPeriod: 15, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: -2, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(task.status).toBe('OPEN')

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(0)
    spy.mockRestore()
  })

  it('falha ao enfileirar TASK_CREATED (ex.: blip do Redis) não reverte o SUCCESS nem reabre a idempotência', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

    // (a) a função continua retornando SUCCESS mesmo com a notificação falhando
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    // (b) o log de geração continua SUCCESS — não foi sobrescrito pra FAILED pelo catch genérico.
    // Busca a competência real gravada na Task (derivada de dueMonth), não um valor recalculado
    // à mão no teste — assim a asserção verifica o comportamento real do serviço.
    const createdTask = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    const competence = createdTask.competence!
    const log = await prisma.recurringGenerationLog.findUnique({
      where: { templateId_clientId_competence: { templateId: template.id, clientId: assignment.clientId, competence } },
    })
    expect(log?.status).toBe('SUCCESS')
    expect(log?.taskId).toBe(outcome.taskId)

    // (c) a chave de idempotência não foi reaberta — uma segunda tentativa continua bloqueada
    spy.mockResolvedValue()
    const second = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
    expect(second.status).toBe('ALREADY_EXISTS')

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    spy.mockRestore()
  })

  it('idempotência: chamar duas vezes pra mesma competência não cria segunda tarefa', async () => {
    const { template, assignment } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const first = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
    const second = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

    expect(first.status).toBe('SUCCESS')
    expect(second.status).toBe('ALREADY_EXISTS')

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    vi.restoreAllMocks()
  })

  it('isolamento de falha: erro inesperado na criação da Task grava FAILED e notifica ORG_ADMIN', async () => {
    const { org, template, assignment } = await setup()
    await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    // Simula uma falha inesperada durante a transação de criação da Task (ex.: erro de conexão
    // com o banco no meio do processo). `vi.spyOn` não serve aqui: o client do Prisma usa
    // proxies internamente e `mockRestore()` deixa o método `undefined` permanentemente pro
    // resto do processo de teste (confirmado — quebrava os testes seguintes do arquivo); por
    // isso a troca/restauração é feita com atribuição direta de propriedade. `$transaction` é
    // interceptado (em vez de `tx.task.create`, que vive num client interno criado pra cada
    // transação e não é o mesmo objeto que `prisma.task`).
    const originalTransaction = prisma.$transaction
    ;(prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = (async () => {
      throw new Error('simulated db failure')
    }) as unknown as typeof prisma.$transaction

    try {
      const dueMonth = new Date(Date.UTC(2026, 2, 1))
      const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

      expect(outcome.status).toBe('FAILED')

      // Nenhuma Task foi criada (falha simulada), então não há como ler a competência real de
      // volta — busca pelo único log desse template/cliente em vez de recalcular a competência
      // derivada à mão no teste.
      const log = await prisma.recurringGenerationLog.findFirst({
        where: { templateId: template.id, clientId: assignment.clientId },
      })
      expect(log?.status).toBe('FAILED')
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'RECURRING_GENERATION_FAILED' }))
    } finally {
      ;(prisma as unknown as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction
      spy.mockRestore()
    }
  })

  it('reprocessamento manual: gera com sucesso depois de um FAILED anterior pra mesma competência', async () => {
    const { template, assignment } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    // competence é o valor já gravado no log (como o cron/uma tentativa anterior teria salvo).
    // dueMonth é o mês de vencimento equivalente que generateTaskForAssignment recebe agora —
    // com competenceMonthOffset=1, dueMonth = competence + 1 mês, pra derivar a mesma competência
    // e colidir com o log FAILED existente.
    const competence = new Date(Date.UTC(2026, 1, 1)) // fevereiro
    const dueMonth = new Date(Date.UTC(2026, 2, 1)) // março
    await prisma.recurringGenerationLog.create({
      data: { templateId: template.id, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage: 'erro antigo' },
    })

    const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)
    expect(outcome.status).toBe('SUCCESS')

    vi.restoreAllMocks()
  })

  it('retry concorrente de uma competência FAILED não duplica a Task (perdedor vira ALREADY_EXISTS)', async () => {
    const { template, assignment } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1)) // fevereiro
    const dueMonth = new Date(Date.UTC(2026, 2, 1)) // março (competenceMonthOffset=1)
    await prisma.recurringGenerationLog.create({
      data: { templateId: template.id, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage: 'erro antigo' },
    })

    const [first, second] = await Promise.all([
      generateTaskForAssignment(template.id, assignment.id, dueMonth),
      generateTaskForAssignment(template.id, assignment.id, dueMonth),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['ALREADY_EXISTS', 'SUCCESS'])

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    const log = await prisma.recurringGenerationLog.findUnique({
      where: { templateId_clientId_competence: { templateId: template.id, clientId: assignment.clientId, competence } },
    })
    expect(log?.status).toBe('SUCCESS')

    vi.restoreAllMocks()
  })
})

describe('generateManually', () => {
  async function setupTemplate() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0, dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })
    return { template, assignment }
  }

  it('lança 409 se já existe SUCCESS pra essa competência', async () => {
    const { template, assignment } = await setupTemplate()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const dueMonthOverride = new Date().toISOString()
    await generateManually(template.id, assignment.id, template.organizationId, dueMonthOverride)

    await expect(
      generateManually(template.id, assignment.id, template.organizationId, dueMonthOverride),
    ).rejects.toMatchObject({ statusCode: 409 })

    vi.restoreAllMocks()
  })

  it('canonicaliza um dueMonthOverride não-canônico pro início do período (MONTHLY)', async () => {
    const { template, assignment } = await setupTemplate()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    // instante arbitrário dentro de setembro/2026, não o dia 1 canônico
    const nonCanonical = new Date(Date.UTC(2026, 8, 17, 13, 22, 0)).toISOString()

    const { taskId } = await generateManually(template.id, assignment.id, template.organizationId, nonCanonical)

    // competenceMonthOffset=0 nesse template → competência derivada coincide com o mês de
    // vencimento canonicalizado (setembro); dueDayOfPeriod=10 → vence 10/setembro.
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-10')

    vi.restoreAllMocks()
  })
})

describe('generateBulkForTemplate', () => {
  it('gera parcial: sucesso + já existe + falha de ID inválido no mesmo lote, sem derrubar os outros', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Lote', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignmentA = await createAssignment(template.id, org.id, { clientId: clientA.id })
    const assignmentB = await createAssignment(template.id, org.id, { clientId: clientB.id })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()

    // Gera uma vez só pra clientB, pra forçar ALREADY_EXISTS no lote
    await generateTaskForAssignment(template.id, assignmentB.id, new Date(Date.UTC(2026, 9, 1)))

    const result = await generateBulkForTemplate(template.id, org.id, dueMonth, [
      assignmentA.id,
      assignmentB.id,
      'cmxxxxxxxxxxxxxxxxxxxxxxx0', // id válido no formato cuid mas inexistente
    ])

    expect(result.generated).toBe(1)
    expect(result.alreadyExists).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].errorMessage).toContain('não encontrado')

    vi.restoreAllMocks()
  })

  it('exceção lançada por generateTaskForAssignment num item não aborta o lote: os demais completam e o item quebrado vira failed[]', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Lote com exceção', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignmentA = await createAssignment(template.id, org.id, { clientId: clientA.id })
    const assignmentB = await createAssignment(template.id, org.id, { clientId: clientB.id })

    // Força generateTaskForAssignment a lançar sincronicamente pro assignmentB — simula um blip
    // de banco no trecho de generateTaskForAssignment que fica FORA do try/catch interno (a
    // busca do assignment por findUnique, antes da checagem de idempotência). Isso exercita
    // exatamente o caminho de exceção que generateBulkForTemplate precisa isolar, não o caminho
    // de "ID inválido" (já coberto pelo teste anterior, que nunca lança — só entra em failed[]
    // pela checagem de `foundIds`).
    const originalFindUnique = prisma.recurringTaskAssignment.findUnique.bind(prisma.recurringTaskAssignment)
    const patchedFindUnique = ((args: { where?: { id?: string } }) => {
      if (args?.where?.id === assignmentB.id) {
        throw new Error('simulated db blip')
      }
      return originalFindUnique(args as Parameters<typeof originalFindUnique>[0])
    }) as unknown as typeof originalFindUnique
    ;(prisma.recurringTaskAssignment as unknown as { findUnique: unknown }).findUnique = patchedFindUnique

    try {
      const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()
      const result = await generateBulkForTemplate(template.id, org.id, dueMonth, [assignmentA.id, assignmentB.id])

      expect(result.generated).toBe(1)
      expect(result.alreadyExists).toBe(0)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].clientName).toBe(clientB.name)
      expect(result.failed[0].errorMessage).toContain('simulated db blip')
    } finally {
      ;(prisma.recurringTaskAssignment as unknown as { findUnique: unknown }).findUnique = originalFindUnique
      vi.restoreAllMocks()
    }
  })

  it('template WEEKLY: gera uma Task por cada segunda-feira do mês escolhido, não só uma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Semanal em lote', periodicity: 'WEEKLY', priority: 'MEDIUM',
      dueDayOfPeriod: 5, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 0,
      generationMonthOffset: 0, generationDayOfPeriod: 1,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })

    // outubro/2026 tem 4 segundas-feiras: 05, 12, 19, 26
    const dueMonth = new Date(Date.UTC(2026, 9, 15)).toISOString()
    const result = await generateBulkForTemplate(template.id, org.id, dueMonth, [assignment.id])

    expect(result.generated).toBe(4)
    expect(result.failed).toHaveLength(0)

    const tasks = await prisma.task.findMany({ where: { recurringTemplateId: template.id } })
    expect(tasks).toHaveLength(4)

    vi.restoreAllMocks()
  })
})

describe('generateBulkForAllTemplates', () => {
  it('roda todos os templates ativos da org, inclusive os sem vínculo (0 geradas)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const withAssignment = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Com vínculo', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(withAssignment.id, org.id, { clientId: client.id })

    await createTemplate(org.id, {
      departmentId: dept.id, title: 'Sem vínculo', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()
    const summaries = await generateBulkForAllTemplates(org.id, dueMonth)

    expect(summaries).toHaveLength(2)
    const withAssignmentSummary = summaries.find((s) => s.templateTitle === 'Com vínculo')
    const withoutAssignmentSummary = summaries.find((s) => s.templateTitle === 'Sem vínculo')
    expect(withAssignmentSummary?.result.generated).toBe(1)
    expect(withoutAssignmentSummary?.result.generated).toBe(0)

    vi.restoreAllMocks()
  })
})

describe('getFailedGenerations', () => {
  it('retorna falhas com nome do cliente, e trata clientId órfão sem quebrar', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Falhável', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: client.id,
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro de teste',
      },
    })
    // clientId que não existe mais (simula cliente excluído depois da falha)
    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: 'cmxxxxxxxxxxxxxxxxxxxxxxx1',
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro órfão',
      },
    })

    const failures = await getFailedGenerations(org.id)
    expect(failures).toHaveLength(2)
    const withClient = failures.find((f) => f.clientId === client.id)
    const orphan = failures.find((f) => f.clientId === 'cmxxxxxxxxxxxxxxxxxxxxxxx1')
    expect(withClient?.clientName).toBe(client.name)
    expect(orphan?.clientName).toBe('(cliente removido)')

    vi.restoreAllMocks()
  })

  it('deriva dueMonth = competência + competenceMonthOffset meses (não o contrário) e marca retryable corretamente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientWithAssignment = await createTestClient(org.id)
    const clientWithoutAssignment = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Falhável com offset', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    // Cliente ainda vinculado (ativo) ao template -> retryable: true
    await createAssignment(template.id, org.id, { clientId: clientWithAssignment.id })

    // competência logada = setembro/2026; com competenceMonthOffset=1, dueMonth esperado é
    // outubro/2026 (setembro + 1 mês) — NUNCA agosto/2026 (setembro - 1 mês), que seria o bug
    // original: retry gerando uma tarefa já vencida.
    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: clientWithAssignment.id,
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro de teste',
      },
    })
    // Cliente sem vínculo ativo ao template -> retryable: false
    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: clientWithoutAssignment.id,
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro de teste 2',
      },
    })

    const failures = await getFailedGenerations(org.id)
    const withAssignment = failures.find((f) => f.clientId === clientWithAssignment.id)
    const withoutAssignment = failures.find((f) => f.clientId === clientWithoutAssignment.id)

    expect(withAssignment?.dueMonth.slice(0, 10)).toBe('2026-10-01')
    expect(withAssignment?.retryable).toBe(true)
    expect(withoutAssignment?.dueMonth.slice(0, 10)).toBe('2026-10-01')
    expect(withoutAssignment?.retryable).toBe(false)

    vi.restoreAllMocks()
  })
})

describe('regenerateTask', () => {
  async function setup(competenceMonthOffset = 1) {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'DAS', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1,
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id })

    // competência setembro/2026, dueMonth = competência + offset (outubro, se offset=1)
    const competence = new Date(Date.UTC(2026, 8, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, new Date(Date.UTC(2026, 9, 1)))
    if (outcome.status !== 'SUCCESS') throw new Error('setup falhou ao gerar a tarefa original')

    return { org, dept, client, template, assignment, competence, taskId: outcome.taskId }
  }

  it('apaga a tarefa sem movimentação e gera uma nova pra mesma competência, com a config atual do template', async () => {
    const { org, template, taskId } = await setup()

    // Corrige o template (como se o operador tivesse ajustado a config errada) antes de regenerar
    await updateTemplate(template.id, org.id, { dueDayOfPeriod: 15 })

    const result = await regenerateTask(taskId, org.id)
    expect(result.taskId).not.toBe(taskId)

    const oldTask = await prisma.task.findUnique({ where: { id: taskId } })
    expect(oldTask).toBeNull()

    const newTask = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId } })
    expect(newTask.competence?.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(newTask.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-15') // dia novo (15), mês igual
  })

  it('bloqueia regeneração se a tarefa já tem histórico além de "created"', async () => {
    const { org, taskId } = await setup()
    await prisma.taskHistory.create({
      data: { taskId, action: 'priority_changed', fromValue: 'MEDIUM', toValue: 'URGENT', actorType: 'user', actorId: 'x', actorName: 'Teste' },
    })

    await expect(regenerateTask(taskId, org.id)).rejects.toMatchObject({ statusCode: 409 })
    const stillThere = await prisma.task.findUnique({ where: { id: taskId } })
    expect(stillThere).not.toBeNull()
  })

  it('bloqueia regeneração se a tarefa tem comentário', async () => {
    const { org, taskId } = await setup()
    await prisma.comment.create({ data: { taskId, content: 'oi', authorType: 'USER' } })

    await expect(regenerateTask(taskId, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('bloqueia regeneração se a tarefa tem anexo', async () => {
    const { org, taskId } = await setup()
    const uploader = await createTestUser(org.id)
    await prisma.attachment.create({
      data: { taskId, filename: 'doc.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'x', uploadedBy: uploader.id },
    })

    await expect(regenerateTask(taskId, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 400 se a tarefa não é recorrente', async () => {
    const { org, taskId } = await setup()
    await prisma.task.update({ where: { id: taskId }, data: { recurringTemplateId: null } })

    await expect(regenerateTask(taskId, org.id)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 409 se o cliente foi desvinculado do template antes de regenerar', async () => {
    const { org, assignment, taskId } = await setup()
    await prisma.recurringTaskAssignment.delete({ where: { id: assignment.id } })

    await expect(regenerateTask(taskId, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('regenerateBulkForTemplate', () => {
  it('regenera em lote: sucesso + sem tarefa gerada pra essa competência + ID inválido, sem derrubar os outros', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'DAS', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1,
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignmentA = await createAssignment(template.id, org.id, { clientId: clientA.id })
    const assignmentB = await createAssignment(template.id, org.id, { clientId: clientB.id })

    // Só gera pra clientA — clientB fica sem tarefa pra essa competência de propósito
    const outcome = await generateTaskForAssignment(template.id, assignmentA.id, new Date(Date.UTC(2026, 9, 1)))
    if (outcome.status !== 'SUCCESS') throw new Error('setup falhou')

    const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()
    const result = await regenerateBulkForTemplate(template.id, org.id, dueMonth, [
      assignmentA.id,
      assignmentB.id,
      'cmxxxxxxxxxxxxxxxxxxxxxxx0',
    ])

    expect(result.regenerated).toBe(1)
    expect(result.failed).toHaveLength(2)
    expect(result.failed.some((f) => f.errorMessage.includes('Nenhuma tarefa gerada'))).toBe(true)
    expect(result.failed.some((f) => f.errorMessage.includes('não encontrado'))).toBe(true)

    const newTask = await prisma.task.findFirst({ where: { recurringTemplateId: template.id } })
    expect(newTask?.id).not.toBe(outcome.taskId)

    vi.restoreAllMocks()
  })
})
