import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import {
  addDocumentRequirement, uploadForRequirement, reviewDocumentRequirement,
  addDeliverable, deliverDocument, recalculateTaskStatus, listTaskDocuments,
} from './task-documents.service'
import {
  createTemplate, createAssignment, generateTaskForAssignment,
} from '@/modules/recurring-templates/recurring-templates.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask, createTestDepartment,
  createTestClientUser, grantClientAccess,
  createTestRecurringAssignment,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')
})

describe('checklist de documento — impedimento automático', () => {
  it('tarefa vai pra BLOCKED quando um documento é adicionado (PENDING)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await addDocumentRequirement(task.id, org.id, 'Ponto', task.creatorId!)
    await recalculateTaskStatus(task.id)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('BLOCKED')
  })

  it('addDocumentRequirement por si só já recalcula o status pra BLOCKED (sem chamada manual a recalculateTaskStatus)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    expect(task.status).toBe('OPEN')

    await addDocumentRequirement(task.id, org.id, 'Extrato bancário', task.creatorId!)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('BLOCKED')
  })

  it('volta pra OPEN quando o único documento pendente é aprovado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, task.departmentId)
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto', task.creatorId!)
    await recalculateTaskStatus(task.id)

    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )
    await reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'APPROVED', undefined)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('OPEN')
  })

  it('rejeição exige motivo e dispara DOCUMENT_REJECTED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, task.departmentId)
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto', task.creatorId!)
    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )

    await expect(
      reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'REJECTED', undefined),
    ).rejects.toMatchObject({ statusCode: 422 })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'REJECTED', 'Ilegível')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'DOCUMENT_REJECTED', metadata: expect.objectContaining({ rejectionReason: 'Ilegível' }) }))

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('BLOCKED')

    spy.mockRestore()
  })

  it('conclusão automática só dispara com autoCompleteOnAllActivitiesDone=true no template de origem', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 1, dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: true, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [],
    })
    const assignment = await createTestRecurringAssignment(template.id, org.id, { clientId: client.id })
    const outcome = await generateTaskForAssignment(template.id, assignment.id, new Date(Date.UTC(2026, 1, 1)))
    if (outcome.status !== 'SUCCESS') throw new Error('geração falhou no setup do teste')

    const requirement = await prisma.taskDocumentRequirement.findFirstOrThrow({ where: { taskId: outcome.taskId } })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, dept.id)
    await uploadForRequirement(
      outcome.taskId, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )
    await reviewDocumentRequirement(outcome.taskId, requirement.id, org.id, user.id, 'APPROVED', undefined)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(updated.status).toBe('DONE')
    expect(updated.completedAt).not.toBeNull()

    vi.restoreAllMocks()
  })
})

describe('verifyTaskAccess (visibilidade no portal)', () => {
  it('lança 404 quando o cliente tenta acessar documentos de uma tarefa com visibleToClient=false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, task.departmentId)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(listTaskDocuments(task.id, org.id, clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    // do lado do escritório (sem clientUserId), continua acessível
    await expect(listTaskDocuments(task.id, org.id)).resolves.toBeDefined()
  })

  it('cliente com acesso a clientA+deptFiscal recebe 404 ao acessar/enviar documento de tarefa de clientA marcada deptPessoal', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const clientA = await createTestClient(org.id, { name: 'Cliente A' })
    const deptFiscal = await createTestDepartment(org.id, { name: `Fiscal ${Date.now()}` })
    const deptPessoal = await createTestDepartment(org.id, { name: `Pessoal ${Date.now()}` })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, deptFiscal.id)
    const board = await createTestBoard(org.id, clientA.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: deptPessoal.id })
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto', task.creatorId!)

    await expect(listTaskDocuments(task.id, org.id, clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      uploadForRequirement(
        task.id, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id,
        { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('notifyIfBlocked (via recalculateTaskStatus)', () => {
  it('enfileira TASK_BLOCKED quando um documento pendente bloqueia a tarefa', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_BLOCKED', taskId: task.id }))
    spy.mockRestore()
  })

  it('não notifica de novo se a tarefa já estava BLOCKED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED' } })
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('não notifica quando a tarefa tem visibleToClient=false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(0)
    spy.mockRestore()
  })

  it('notifica quando a tarefa tem visibleToClient=true (default)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    expect(task.visibleToClient).toBe(true)
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(1)
    spy.mockRestore()
  })

  it('não notifica ao resolver o impedimento (BLOCKED -> OPEN)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED' } })
    const req = await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })
    await prisma.taskDocumentRequirement.update({ where: { id: req.id }, data: { status: 'APPROVED' } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('cliente não troca documento já aprovado nem envia em tarefa encerrada', () => {
  async function setup() {
    const org = await createTestOrg((await createTestPlan()).id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const col = await createTestColumn((await createTestBoard(org.id, client.id)).id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, task.departmentId)
    const requirement = await addDocumentRequirement(task.id, org.id, 'Contrato social', task.creatorId!)
    const file = (name: string) => ({ filename: name, mimeType: 'application/pdf', size: 10, buffer: Buffer.from('x') })
    const asClient = (name: string) => uploadForRequirement(task.id, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id, file(name))
    return { org, user, task, requirement, asClient, file }
  }

  it('an approved document stays as approved: the client cannot replace it (the office still can)', async () => {
    const c = await setup()
    await c.asClient('contrato.pdf')
    await reviewDocumentRequirement(c.task.id, c.requirement.id, c.org.id, c.user.id, 'APPROVED', undefined)
    const approved = await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: c.requirement.id } })

    await expect(c.asClient('outro.pdf')).rejects.toMatchObject({ statusCode: 409 })
    const after = await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: c.requirement.id } })
    expect(after).toMatchObject({ status: 'APPROVED', attachmentId: approved.attachmentId })

    await uploadForRequirement(c.task.id, c.requirement.id, c.org.id, { id: c.user.id, type: 'user' }, undefined, c.file('versao-escritorio.pdf'))
  })

  it('a finished task takes no more files from the client', async () => {
    const c = await setup()
    await prisma.task.update({ where: { id: c.task.id }, data: { status: 'DONE' } })
    await expect(c.asClient('tarde.pdf')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('a pending, refused or not yet reviewed document can still be sent again', async () => {
    const c = await setup()
    await c.asClient('v1.pdf')
    await c.asClient('v2.pdf')
    await reviewDocumentRequirement(c.task.id, c.requirement.id, c.org.id, c.user.id, 'REJECTED', 'Ilegível')
    await c.asClient('v3.pdf')
    expect((await prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: c.requirement.id } })).status).toBe('UPLOADED')
  })
})

it('the document list brings the file name and a link, never the storage key nor internal ids', async () => {
  const org = await createTestOrg((await createTestPlan()).id)
  const user = await createTestUser(org.id)
  const client = await createTestClient(org.id)
  const col = await createTestColumn((await createTestBoard(org.id, client.id)).id, { position: 0 })
  const task = await createTestTask(col.id, user.id)
  const { clientUser } = await createTestClientUser(org.id)
  await grantClientAccess(clientUser.id, client.id, task.departmentId)
  const requirement = await addDocumentRequirement(task.id, org.id, 'Contrato', task.creatorId!)
  await uploadForRequirement(task.id, requirement.id, org.id, { id: clientUser.id, type: 'client' }, clientUser.id,
    { filename: 'contrato.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from('x') })

  const docs = await listTaskDocuments(task.id, org.id, clientUser.id)
  expect(docs.requirements[0]).toMatchObject({ attachment: { filename: 'contrato.pdf' }, signedUrl: 'https://signed-url' })
  const body = JSON.stringify(docs)
  expect(body).not.toContain('storageKey')
  expect(body).not.toContain('uploadedByClientUserId')
})
