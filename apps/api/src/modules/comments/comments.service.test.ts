import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { deleteComment, listComments, createComment } from './comments.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestDepartment,
} from '@/test/helpers'

async function createPlan() {
  return prisma.plan.create({
    data: {
      name: 'Test Plan',
      priceMonthly: 0,
      maxClients: 100,
      features: [],
    },
  })
}

describe('deleteComment - soft delete', () => {
  it('marca deletedAt em vez de remover o registro', async () => {
    const plan = await createPlan()
    const org = await prisma.organization.create({
      data: { name: 'Org', slug: 'org-test-1', email: 'o@o.com', planId: plan.id },
    })
    const user = await prisma.user.create({
      data: { name: 'João', email: 'j@j.com', passwordHash: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'Empresa X', email: 'x@x.com', passwordHash: 'x', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Texto importante', taskId: task.id, authorType: 'USER', userId: user.id },
    })

    await deleteComment(comment.id, { id: user.id, role: 'ORG_ADMIN', organizationId: org.id })

    const found = await prisma.comment.findUnique({ where: { id: comment.id } })
    expect(found).not.toBeNull()
    expect(found!.deletedAt).not.toBeNull()
    expect(found!.deletedBy).toBe(user.id)
    expect(found!.deletedByType).toBe('USER')
    expect(found!.content).toBe('Texto importante')
  })

  it('cliente só pode soft-deletar o próprio comentário', async () => {
    const plan = await createPlan()
    const org = await prisma.organization.create({
      data: { name: 'Org2', slug: 'org-test-2', email: 'o2@o.com', planId: plan.id },
    })
    const user = await prisma.user.create({
      data: { name: 'J', email: 'j2@j.com', passwordHash: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'EmpY', email: 'y@y.com', passwordHash: 'x', organizationId: org.id },
    })
    const otherClient = await prisma.client.create({
      data: { name: 'EmpZ', email: 'z@z.com', passwordHash: 'x', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Comentário do outro', taskId: task.id, authorType: 'CLIENT', clientId: client.id },
    })

    // otherClient belongs to a different board — board isolation check fires first
    await expect(
      deleteComment(comment.id, { id: otherClient.id, role: 'CLIENT', organizationId: org.id })
    ).rejects.toThrow('Acesso negado')
  })
})

describe('listComments - soft delete visibility', () => {
  it('ORG_MEMBER não vê conteúdo de comentário deletado', async () => {
    const plan = await createPlan()
    const org = await prisma.organization.create({
      data: { name: 'Org3', slug: 'org-test-3', email: 'o3@o.com', planId: plan.id },
    })
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'a3@a.com', passwordHash: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'EmpW', email: 'w@w.com', passwordHash: 'x', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: admin.id },
    })
    await prisma.comment.create({
      data: {
        content: 'Segredo',
        taskId: task.id,
        authorType: 'CLIENT',
        clientId: client.id,
        deletedAt: new Date(),
        deletedBy: client.id,
        deletedByType: 'CLIENT',
      },
    })

    const resultMember = await listComments(task.id, org.id, 'ORG_MEMBER')
    expect(resultMember[0].content).toBeNull()
    expect((resultMember[0] as any).deletedContent).toBeUndefined()

    const resultAdmin = await listComments(task.id, org.id, 'ORG_ADMIN')
    expect((resultAdmin[0] as any).deletedContent).toBe('Segredo')
  })
})

describe('createComment - roteamento de notificação por departamento', () => {
  beforeEach(() => {
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('com departmentId na task, notifica apenas o responsável daquele departamento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id, { position: 0 })
    const departmentA = await createTestDepartment(org.id, { name: `Dept A ${Date.now()}` })
    const departmentB = await createTestDepartment(org.id, { name: `Dept B ${Date.now()}` })
    const userA = await createTestUser(org.id, { email: `a-${Date.now()}@test.com` })
    const userB = await createTestUser(org.id, { email: `b-${Date.now()}@test.com` })
    await prisma.clientAssignment.create({
      data: { clientId: client.id, departmentId: departmentA.id, userId: userA.id },
    })
    await prisma.clientAssignment.create({
      data: { clientId: client.id, departmentId: departmentB.id, userId: userB.id },
    })
    const task = await prisma.task.create({
      data: {
        title: 'Tarefa com departamento',
        position: 0,
        columnId: column.id,
        creatorId: userA.id,
        departmentId: departmentA.id,
      },
    })

    await createComment(task.id, { content: 'Olá' }, { id: client.id, role: 'CLIENT', organizationId: org.id })

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(1)
    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userA.id }),
    )
  })

  it('sem departmentId na task, cai no fallback e notifica todos os responsáveis do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id, { position: 0 })
    const departmentA = await createTestDepartment(org.id, { name: `Dept A ${Date.now()}` })
    const departmentB = await createTestDepartment(org.id, { name: `Dept B ${Date.now()}` })
    const userA = await createTestUser(org.id, { email: `a-${Date.now()}@test.com` })
    const userB = await createTestUser(org.id, { email: `b-${Date.now()}@test.com` })
    await prisma.clientAssignment.create({
      data: { clientId: client.id, departmentId: departmentA.id, userId: userA.id },
    })
    await prisma.clientAssignment.create({
      data: { clientId: client.id, departmentId: departmentB.id, userId: userB.id },
    })
    const task = await prisma.task.create({
      data: {
        title: 'Tarefa sem departamento',
        position: 0,
        columnId: column.id,
        creatorId: userA.id,
      },
    })

    await createComment(task.id, { content: 'Olá' }, { id: client.id, role: 'CLIENT', organizationId: org.id })

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(2)
    const notifiedUserIds = vi.mocked(queue.enqueueNotification).mock.calls.map((c) => c[0].userId)
    expect(notifiedUserIds).toContain(userA.id)
    expect(notifiedUserIds).toContain(userB.id)
  })
})
