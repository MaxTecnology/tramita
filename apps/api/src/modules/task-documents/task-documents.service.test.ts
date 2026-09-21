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

    await addDocumentRequirement(task.id, org.id, 'Ponto')
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

    await addDocumentRequirement(task.id, org.id, 'Extrato bancário')

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
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto')
    await recalculateTaskStatus(task.id)

    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
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
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto')
    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
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
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: true, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    const outcome = await generateTaskForAssignment(template.id, assignment.id, new Date(Date.UTC(2026, 1, 1)))
    if (outcome.status !== 'SUCCESS') throw new Error('geração falhou no setup do teste')

    const requirement = await prisma.taskDocumentRequirement.findFirstOrThrow({ where: { taskId: outcome.taskId } })
    await uploadForRequirement(
      outcome.taskId, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )
    await reviewDocumentRequirement(outcome.taskId, requirement.id, org.id, user.id, 'APPROVED', undefined)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(updated.status).toBe('DONE')

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
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(listTaskDocuments(task.id, org.id, client.id)).rejects.toMatchObject({ statusCode: 404 })
    // do lado do escritório (sem clientId), continua acessível
    await expect(listTaskDocuments(task.id, org.id)).resolves.toBeDefined()
  })
})
