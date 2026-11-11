import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getPortfolio, transferResponsibilities } from './responsibility-transfer.service'
import {
  createTestBoard, createTestClient, createTestColumn, createTestDepartment, createTestOrg, createTestPlan,
  createTestTask, createTestUser, serveClientDepartment,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const from = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const to = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })

  const acme = await createTestClient(org.id, { name: 'ACME', codigo: '001' })
  await serveClientDepartment(acme.id, fiscal.id, from.id)
  await serveClientDepartment(acme.id, folha.id, from.id)
  const acmeBoard = await createTestBoard(org.id, acme.id)
  await prisma.board.update({ where: { id: acmeBoard.id }, data: { responsibleUserId: from.id } })
  const column = await createTestColumn(acmeBoard.id)
  const fiscalTask = await createTestTask(column.id, admin.id, { departmentId: fiscal.id })
  const folhaTask = await createTestTask(column.id, admin.id, { departmentId: folha.id, position: 1 })
  const doneTask = await createTestTask(column.id, admin.id, { departmentId: fiscal.id, position: 2 })
  await prisma.task.updateMany({ where: { id: { in: [fiscalTask.id, folhaTask.id, doneTask.id] } }, data: { assigneeId: from.id } })
  await prisma.task.update({ where: { id: doneTask.id }, data: { status: 'DONE' } })

  const beta = await createTestClient(org.id, { name: 'Beta', codigo: '002' })
  await serveClientDepartment(beta.id, fiscal.id, from.id)

  return { org, admin, from, to, fiscal, folha, acme, acmeBoard, fiscalTask, folhaTask, doneTask, beta }
}

describe('getPortfolio', () => {
  it('agrupa por cliente com departamentos, processos e tarefas abertas', async () => {
    const { org, from, acme, beta } = await setup()

    const portfolio = await getPortfolio(from.id, org.id)

    const acmeEntry = portfolio.find((p) => p.clientId === acme.id)
    expect(acmeEntry).toMatchObject({ clientName: 'ACME', codigo: '001', boardsCount: 1, openTasksCount: 2 })
    expect(acmeEntry?.departments.map((d) => d.name).sort()).toEqual(['Fiscal', 'Folha'])
    expect(portfolio.find((p) => p.clientId === beta.id)).toMatchObject({ boardsCount: 0, openTasksCount: 0 })
  })

  it('com filtro de departamento, só conta aquele departamento e zera processos', async () => {
    const { org, from, folha, acme } = await setup()

    const portfolio = await getPortfolio(from.id, org.id, folha.id)

    expect(portfolio).toHaveLength(1)
    expect(portfolio[0]).toMatchObject({ clientId: acme.id, boardsCount: 0, openTasksCount: 1 })
    expect(portfolio[0].departments.map((d) => d.name)).toEqual(['Folha'])
  })

  it('ignora clientes desativados', async () => {
    const { org, from, beta } = await setup()
    await prisma.client.update({ where: { id: beta.id }, data: { isActive: false } })

    const portfolio = await getPortfolio(from.id, org.id)

    expect(portfolio.map((p) => p.clientId)).not.toContain(beta.id)
  })
})

describe('transferResponsibilities', () => {
  it('move responsáveis, processos e tarefas abertas dos clientes escolhidos e registra histórico', async () => {
    const ctx = await setup()

    const result = await transferResponsibilities(ctx.from.id, ctx.org.id, {
      toUserId: ctx.to.id, clientIds: [ctx.acme.id], includeBoards: true, includeTasks: true,
    }, ctx.admin.id)

    expect(result).toEqual({ assignments: 2, boards: 1, tasks: 2 })
    expect(await prisma.clientAssignment.count({ where: { clientId: ctx.acme.id, userId: ctx.to.id } })).toBe(2)
    expect((await prisma.board.findUniqueOrThrow({ where: { id: ctx.acmeBoard.id } })).responsibleUserId).toBe(ctx.to.id)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ctx.fiscalTask.id } })).assigneeId).toBe(ctx.to.id)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ctx.doneTask.id } })).assigneeId).toBe(ctx.from.id)
    expect(await prisma.clientAssignment.count({ where: { clientId: ctx.beta.id, userId: ctx.from.id } })).toBe(1)
    const history = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: ctx.fiscalTask.id, action: 'assigned_to' } })
    expect(history).toMatchObject({ fromValue: ctx.from.id, toValue: ctx.to.id, actorId: ctx.admin.id })
  })

  it('com departamento, não move processos e só move o que é daquele departamento', async () => {
    const ctx = await setup()

    const result = await transferResponsibilities(ctx.from.id, ctx.org.id, {
      toUserId: ctx.to.id, clientIds: [ctx.acme.id], departmentId: ctx.folha.id, includeBoards: true, includeTasks: true,
    }, ctx.admin.id)

    expect(result).toEqual({ assignments: 1, boards: 0, tasks: 1 })
    expect((await prisma.board.findUniqueOrThrow({ where: { id: ctx.acmeBoard.id } })).responsibleUserId).toBe(ctx.from.id)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ctx.fiscalTask.id } })).assigneeId).toBe(ctx.from.id)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ctx.folhaTask.id } })).assigneeId).toBe(ctx.to.id)
  })

  it('includeTasks false mantém as tarefas com quem estava', async () => {
    const ctx = await setup()

    const result = await transferResponsibilities(ctx.from.id, ctx.org.id, {
      toUserId: ctx.to.id, clientIds: [ctx.acme.id], includeBoards: true, includeTasks: false,
    }, ctx.admin.id)

    expect(result.tasks).toBe(0)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ctx.fiscalTask.id } })).assigneeId).toBe(ctx.from.id)
  })

  it('valida destino, origem e carteira', async () => {
    const ctx = await setup()
    const inactive = await createTestUser(ctx.org.id, { isActive: false })
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)
    const outsider = await createTestUser(otherOrg.id)
    const notMine = await createTestClient(ctx.org.id)
    const base = { clientIds: [ctx.acme.id], includeBoards: true, includeTasks: true }

    await expect(transferResponsibilities(ctx.from.id, ctx.org.id, { ...base, toUserId: inactive.id }, ctx.admin.id))
      .rejects.toMatchObject({ statusCode: 400, message: 'Colaborador de destino inválido' })
    await expect(transferResponsibilities(ctx.from.id, ctx.org.id, { ...base, toUserId: outsider.id }, ctx.admin.id))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect(transferResponsibilities(ctx.from.id, ctx.org.id, { ...base, toUserId: ctx.from.id }, ctx.admin.id))
      .rejects.toMatchObject({ statusCode: 400, message: 'Escolha um colaborador diferente do atual' })
    await expect(transferResponsibilities(ctx.from.id, ctx.org.id, { ...base, clientIds: [notMine.id], toUserId: ctx.to.id }, ctx.admin.id))
      .rejects.toMatchObject({ statusCode: 400, message: 'Cliente fora da carteira deste colaborador' })
  })
})
