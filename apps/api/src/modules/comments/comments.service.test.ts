import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { deleteComment, listComments, createComment } from './comments.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestClientUser,
  grantClientAccess,
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
      data: { name: 'Empresa X', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const department = await createTestDepartment(org.id)
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id, departmentId: department.id },
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

  it('cliente sem acesso à empresa recebe 404 (nunca revela que o comentário existe)', async () => {
    const plan = await createPlan()
    const org = await prisma.organization.create({
      data: { name: 'Org2', slug: 'org-test-2', email: 'o2@o.com', planId: plan.id },
    })
    const user = await prisma.user.create({
      data: { name: 'J', email: 'j2@j.com', passwordHash: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'EmpY', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const department = await createTestDepartment(org.id)
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id, departmentId: department.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Comentário do outro', taskId: task.id, authorType: 'CLIENT', clientId: client.id },
    })

    // otherClientUser has no access grant to `client` — scope check fires first, and must
    // 404 (not 403) so it never reveals the comment exists outside the caller's scope
    const { clientUser: otherClientUser } = await createTestClientUser(org.id)
    await expect(
      deleteComment(comment.id, { id: otherClientUser.id, role: 'CLIENT', organizationId: org.id })
    ).rejects.toMatchObject({ statusCode: 404 })
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
      data: { name: 'EmpW', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const department = await createTestDepartment(org.id)
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: admin.id, departmentId: department.id },
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

describe('visibilidade (visibleToClient) — comments', () => {
  it('listComments lança 404 pro cliente quando a tarefa não é visível', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id, { position: 0 })
    const task = await prisma.task.create({
      data: { title: 'Tarefa oculta', position: 0, columnId: column.id, creatorId: admin.id, departmentId: department.id, visibleToClient: false },
    })

    await expect(listComments(task.id, org.id, 'CLIENT', clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    // do lado do escritório continua acessível
    await expect(listComments(task.id, org.id, 'ORG_ADMIN')).resolves.toBeDefined()
  })

  it('createComment lança 404 quando o cliente tenta comentar em tarefa não-visível', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id, { position: 0 })
    const task = await prisma.task.create({
      data: { title: 'Tarefa oculta', position: 0, columnId: column.id, creatorId: admin.id, departmentId: department.id, visibleToClient: false },
    })

    await expect(
      createComment(task.id, { content: 'Olá' }, { id: clientUser.id, role: 'CLIENT', organizationId: org.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('acesso por departamento (canSeeTask) — comments', () => {
  it('cliente com acesso a clientA+deptFiscal recebe 404 ao acessar/comentar/apagar comentário de tarefa de clientA marcada deptPessoal', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const clientA = await createTestClient(org.id, { name: 'Cliente A' })
    const deptFiscal = await createTestDepartment(org.id, { name: `Fiscal ${Date.now()}` })
    const deptPessoal = await createTestDepartment(org.id, { name: `Pessoal ${Date.now()}` })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, deptFiscal.id)
    const board = await createTestBoard(org.id, clientA.id)
    const column = await createTestColumn(board.id, { position: 0 })
    const task = await prisma.task.create({
      data: { title: 'Folha de pagamento', position: 0, columnId: column.id, creatorId: admin.id, departmentId: deptPessoal.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Confidencial', taskId: task.id, authorType: 'USER', userId: admin.id },
    })

    await expect(listComments(task.id, org.id, 'CLIENT', clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      createComment(task.id, { content: 'Olá' }, { id: clientUser.id, role: 'CLIENT', organizationId: org.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      deleteComment(comment.id, { id: clientUser.id, role: 'CLIENT', organizationId: org.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
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
    const departmentA = await createTestDepartment(org.id, { name: `Dept A ${Date.now()}` })
    const departmentB = await createTestDepartment(org.id, { name: `Dept B ${Date.now()}` })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, departmentA.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id, { position: 0 })
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

    await createComment(task.id, { content: 'Olá' }, { id: clientUser.id, role: 'CLIENT', organizationId: org.id })

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(1)
    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userA.id }),
    )
  })

  // "sem departmentId" removida: Task.departmentId agora é obrigatório no schema (migration
  // 20260921210100_task_department_required), então esse cenário não é mais produzível — o
  // fallback "notifica todos os responsáveis" em comments.service.ts também deixou de ser
  // alcançável e foi simplificado junto.
})
