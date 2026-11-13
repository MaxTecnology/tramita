import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestDepartment,
  serveClientDepartment,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

// Carteira do Membro (com "ver colegas" desligado — sem o alcance do departamento): vê um processo
// quando é o responsável do processo, OU é responsável por algum departamento que atende o cliente
// (ClientAssignment), OU tem tarefa atribuída nele. O alcance do departamento está em
// staff-scope.routes.test.ts.
async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER', seesDepartmentWork: false })
  const other = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dept = await createTestDepartment(org.id)

  // Cliente atendido pela member (ela é a responsável do departamento)
  const servedClient = await createTestClient(org.id)
  await serveClientDepartment(servedClient.id, dept.id, member.id)
  const servedBoard = await createTestBoard(org.id, servedClient.id) // sem responsável

  // Cliente de outra pessoa — processo sem nenhum vínculo com a member
  const foreignClient = await createTestClient(org.id)
  await serveClientDepartment(foreignClient.id, dept.id, other.id)
  const foreignBoard = await createTestBoard(org.id, foreignClient.id)

  // Processo de cliente alheio, mas com tarefa atribuída à member
  const assignedBoard = await createTestBoard(org.id, foreignClient.id)
  const col = await createTestColumn(assignedBoard.id)
  const task = await createTestTask(col.id, admin.id, { departmentId: dept.id })
  await prisma.task.update({ where: { id: task.id }, data: { assigneeId: member.id } })

  // Processo de cliente alheio, com a member como responsável do processo
  const ownBoard = await createTestBoard(org.id, foreignClient.id)
  await prisma.board.update({ where: { id: ownBoard.id }, data: { responsibleUserId: member.id } })

  const auth = await getAuthHeader(member.email, 'Test@1234')
  const adminAuth = await getAuthHeader(admin.email, 'Test@1234')
  return { auth, adminAuth, servedBoard, foreignBoard, assignedBoard, ownBoard }
}

describe('visibilidade de processos pro ORG_MEMBER', () => {
  it('lista: vê os do cliente que atende, os com tarefa dele e os que é responsável — não os alheios', async () => {
    const { auth, servedBoard, foreignBoard, assignedBoard, ownBoard } = await setup()

    const res = await app.inject({ method: 'GET', url: '/boards', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    const ids = (JSON.parse(res.body) as { id: string }[]).map((b) => b.id).sort()
    expect(ids).toEqual([servedBoard.id, assignedBoard.id, ownBoard.id].sort())
    expect(ids).not.toContain(foreignBoard.id)
  })

  it('link direto: processo alheio responde 404; processo visível abre normalmente', async () => {
    const { auth, servedBoard, foreignBoard } = await setup()

    const foreign = await app.inject({ method: 'GET', url: `/boards/${foreignBoard.id}`, headers: { authorization: auth } })
    expect(foreign.statusCode).toBe(404)

    const served = await app.inject({ method: 'GET', url: `/boards/${servedBoard.id}`, headers: { authorization: auth } })
    expect(served.statusCode).toBe(200)
  })

  it('dashboard: "processos ativos" do membro conta só os que ele vê; o admin continua vendo todos', async () => {
    const { auth, adminAuth } = await setup()

    const member = await app.inject({ method: 'GET', url: '/dashboard/metrics', headers: { authorization: auth } })
    expect(JSON.parse(member.body).kpis.activeBoards).toBe(3)

    const admin = await app.inject({ method: 'GET', url: '/dashboard/metrics', headers: { authorization: adminAuth } })
    expect(JSON.parse(admin.body).kpis.activeBoards).toBe(4)
  })
})
