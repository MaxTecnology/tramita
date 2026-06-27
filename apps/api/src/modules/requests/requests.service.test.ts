import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import {
  createRequest,
  listRequestsForOrg,
  listRequestsForClient,
  getRequestById,
  cancelRequest,
  approveRequest,
  rejectRequest,
} from './requests.service'
import { createBoard } from '@/modules/boards/boards.service'

beforeEach(() => {
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('createRequest', () => {
  it('cria a request como PENDING e enfileira REQUEST_CREATED para cada ORG_ADMIN/ORG_MANAGER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    await createTestUser(org.id, { role: 'ORG_MEMBER' }) // não deve ser notificado
    const client = await createTestClient(org.id)

    const request = await createRequest(org.id, client.id, { title: 'Abertura de LTDA' })

    expect(request.status).toBe('PENDING')
    expect(request.clientId).toBe(client.id)

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(2)
    const calledUserIds = vi.mocked(queue.enqueueNotification).mock.calls.map((c) => c[0].userId)
    expect(calledUserIds).toContain(admin.id)
    expect(calledUserIds).toContain(manager.id)
  })

  it('lança 404 se o cliente não pertence à org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const otherOrg = await createTestOrg(plan.id, { slug: 'other-org' })
    const client = await createTestClient(otherOrg.id)

    await expect(createRequest(org.id, client.id, { title: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('listRequestsForOrg / listRequestsForClient / getRequestById', () => {
  it('lista requests da org e filtra por status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    await createRequest(org.id, client.id, { title: 'Pedido 1' })
    const r2 = await createRequest(org.id, client.id, { title: 'Pedido 2' })
    await cancelRequest(r2.id, org.id, client.id)

    const all = await listRequestsForOrg(org.id)
    expect(all).toHaveLength(2)

    const onlyCancelled = await listRequestsForOrg(org.id, 'CANCELLED')
    expect(onlyCancelled).toHaveLength(1)
    expect(onlyCancelled[0].title).toBe('Pedido 2')
  })

  it('cliente só vê as próprias requests', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b@test.com' })
    await createRequest(org.id, clientA.id, { title: 'Da A' })
    await createRequest(org.id, clientB.id, { title: 'Da B' })

    const result = await listRequestsForClient(org.id, clientA.id)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Da A')
  })

  it('getRequestById lança 404 quando clientId não é o dono', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a2@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b2@test.com' })
    const request = await createRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(getRequestById(request.id, org.id, clientB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('cancelRequest', () => {
  it('cancela uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const cancelled = await cancelRequest(request.id, org.id, client.id)
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('lança 422 ao tentar cancelar uma request já cancelada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await cancelRequest(request.id, org.id, client.id)

    await expect(cancelRequest(request.id, org.id, client.id)).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('approveRequest', () => {
  it('mode NEW_BOARD cria board com 3 colunas padrão e task na primeira coluna', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Abertura de LTDA', description: 'Detalhes' })

    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    expect(approved.status).toBe('APPROVED')
    expect(approved.taskId).not.toBeNull()
    expect(approved.reviewedById).toBe(admin.id)

    const task = await prisma.task.findUnique({ where: { id: approved.taskId! } })
    expect(task?.title).toBe('Abertura de LTDA')
    expect(task?.sourceRequestId).toBe(request.id)

    const board = await prisma.board.findFirst({ where: { clientId: client.id } })
    expect(board?.title).toBe('Abertura de LTDA')
  })

  it('mode EXISTING_BOARD cria task na coluna informada de um board já existente do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const existingBoard = await createBoard(org.id, admin.id, 'ORG_ADMIN', { title: 'Processo já aberto', clientId: client.id })
    const request = await createRequest(org.id, client.id, { title: 'Documento extra' })

    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', {
      mode: 'EXISTING_BOARD',
      boardId: existingBoard.id,
      columnId: existingBoard.columns[0].id,
    })

    const task = await prisma.task.findUnique({ where: { id: approved.taskId! } })
    expect(task?.columnId).toBe(existingBoard.columns[0].id)
  })

  it('lança 404 se o board existente não pertence ao cliente da request', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const clientA = await createTestClient(org.id, { email: 'a3@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b3@test.com' })
    const boardOfB = await createBoard(org.id, admin.id, 'ORG_ADMIN', { title: 'Board de B', clientId: clientB.id })
    const request = await createRequest(org.id, clientA.id, { title: 'Pedido de A' })

    await expect(
      approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', {
        mode: 'EXISTING_BOARD',
        boardId: boardOfB.id,
        columnId: boardOfB.columns[0].id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 422 ao aprovar uma request que já foi avaliada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    await expect(
      approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('rejectRequest', () => {
  it('rejeita com motivo e grava reviewedBy/reviewedAt', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const rejected = await rejectRequest(request.id, org.id, admin.id, { reason: 'Fora de escopo' })

    expect(rejected.status).toBe('REJECTED')
    expect(rejected.rejectionReason).toBe('Fora de escopo')
    expect(rejected.reviewedById).toBe(admin.id)
  })
})
