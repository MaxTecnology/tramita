import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  assertCanUnserveDepartments,
  assertDepartmentServesClient,
  assertPayloadCoverage,
  listServedDepartmentIds,
} from './client-coverage'
import {
  createTestBoard,
  createTestClient,
  createTestColumn,
  createTestDepartment,
  createTestOrg,
  createTestPlan,
  createTestTask,
  createTestUser,
  serveClientDepartment,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const client = await createTestClient(org.id, { name: 'ACME' })
  return { org, user, fiscal, folha, client }
}

describe('assertPayloadCoverage', () => {
  const names = new Map([['d1', 'Fiscal'], ['d2', 'Folha']])

  it('recusa departamento atendido sem nenhum usuário do cliente', () => {
    expect(() =>
      assertPayloadCoverage(
        [{ departmentId: 'd1', responsibleUserId: 'u' }, { departmentId: 'd2', responsibleUserId: 'u' }],
        [{ name: 'Ana', email: 'a@a.com', password: '12345678', departmentIds: ['d1'] }],
        names,
      ),
    ).toThrow('O departamento Folha precisa de pelo menos um usuário do cliente com acesso.')
  })

  it('recusa acesso a departamento que não atende o cliente', () => {
    expect(() =>
      assertPayloadCoverage(
        [{ departmentId: 'd1', responsibleUserId: 'u' }],
        [{ name: 'Ana', email: 'a@a.com', password: '12345678', departmentIds: ['d1', 'd2'] }],
        names,
      ),
    ).toThrow('O departamento Folha não atende este cliente.')
  })

  it('aceita payload com todos os departamentos cobertos', () => {
    expect(() =>
      assertPayloadCoverage(
        [{ departmentId: 'd1', responsibleUserId: 'u' }, { departmentId: 'd2', responsibleUserId: 'u' }],
        [
          { existingId: 'cu1', departmentIds: ['d1'] },
          { name: 'Ana', email: 'a@a.com', password: '12345678', departmentIds: ['d2'] },
        ],
        names,
      ),
    ).not.toThrow()
  })
})

describe('assertDepartmentServesClient / listServedDepartmentIds', () => {
  it('recusa departamento sem ClientAssignment, citando departamento e cliente', async () => {
    const { client, fiscal } = await setup()
    await expect(assertDepartmentServesClient(prisma, client.id, fiscal.id)).rejects.toMatchObject({
      statusCode: 400,
      message: 'O departamento Fiscal não atende o cliente ACME.',
    })
  })

  it('aceita departamento atendido e lista os atendidos', async () => {
    const { client, fiscal, user } = await setup()
    await serveClientDepartment(client.id, fiscal.id, user.id)
    await expect(assertDepartmentServesClient(prisma, client.id, fiscal.id)).resolves.toBe(user.id)
    expect(await listServedDepartmentIds(prisma, client.id)).toEqual([fiscal.id])
  })
})

describe('assertCanUnserveDepartments', () => {
  it('recusa quando há tarefa aberta do cliente no departamento', async () => {
    const { org, client, folha, user } = await setup()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, user.id, { departmentId: folha.id })

    await expect(assertCanUnserveDepartments(prisma, client.id, [folha.id])).rejects.toMatchObject({
      statusCode: 409,
      message: 'Não é possível remover o departamento Folha: há 1 tarefa(s) aberta(s) deste cliente nele.',
    })
  })

  it('permite quando só há tarefas concluídas ou desconsideradas', async () => {
    const { org, client, folha, user } = await setup()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const done = await createTestTask(column.id, user.id, { departmentId: folha.id })
    const disregarded = await createTestTask(column.id, user.id, { departmentId: folha.id, position: 1 })
    await prisma.task.update({ where: { id: done.id }, data: { status: 'DONE' } })
    await prisma.task.update({ where: { id: disregarded.id }, data: { status: 'DISREGARDED' } })

    await expect(assertCanUnserveDepartments(prisma, client.id, [folha.id])).resolves.toBeUndefined()
  })

  it('recusa quando há vínculo recorrente ativo de template do departamento', async () => {
    const { org, client, folha } = await setup()
    const template = await prisma.recurringTaskTemplate.create({
      data: {
        organizationId: org.id, departmentId: folha.id, title: 'Folha mensal', periodicity: 'MONTHLY',
        dueDayOfPeriod: 10, generationDayOfPeriod: 1,
      },
    })
    await prisma.recurringTaskAssignment.create({ data: { templateId: template.id, clientId: client.id } })

    await expect(assertCanUnserveDepartments(prisma, client.id, [folha.id])).rejects.toMatchObject({
      statusCode: 409,
      message: 'Não é possível remover o departamento Folha: há 1 tarefa(s) recorrente(s) deste cliente nele.',
    })
  })

  it('recusa quando há solicitação pendente ou aguardando informação no departamento', async () => {
    const { org, client, folha } = await setup()
    await prisma.request.create({ data: { organizationId: org.id, clientId: client.id, title: 'A', departmentId: folha.id } })
    await prisma.request.create({
      data: { organizationId: org.id, clientId: client.id, title: 'B', departmentId: folha.id, status: 'NEEDS_INFO' },
    })

    await expect(assertCanUnserveDepartments(prisma, client.id, [folha.id])).rejects.toMatchObject({
      statusCode: 409,
      message: 'Não é possível remover o departamento Folha: há 2 solicitação(ões) pendente(s) deste cliente nele.',
    })
  })

  it('junta as contagens maiores que zero na mesma mensagem', async () => {
    const { org, client, folha, user } = await setup()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, user.id, { departmentId: folha.id })
    await prisma.request.create({ data: { organizationId: org.id, clientId: client.id, title: 'A', departmentId: folha.id } })

    await expect(assertCanUnserveDepartments(prisma, client.id, [folha.id])).rejects.toMatchObject({
      message: 'Não é possível remover o departamento Folha: há 1 tarefa(s) aberta(s) e 1 solicitação(ões) pendente(s) deste cliente nele.',
    })
  })
})
