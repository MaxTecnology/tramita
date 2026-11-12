import { describe, it, expect, vi, afterEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTemplate, generateManually } from '@/modules/recurring-templates/recurring-templates.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestDepartment,
  serveClientDepartment,
  createTestBoard,
  createTestColumn,
  createTestRecurringAssignment,
  getAuthHeader,
} from '@/test/helpers'

// Departamento atendido sempre tem responsável (ClientAssignment.userId). Tarefa criada sem
// responsável herda esse responsável — senão some da tela "Tarefas" do membro.
async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const ana = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, dept.id, bruna.id)
  return { org, admin, bruna, ana, dept, client }
}

afterEach(() => vi.restoreAllMocks())

describe('responsável padrão da tarefa = responsável do departamento no cliente', () => {
  it('tarefa criada no processo sem responsável herda o responsável do departamento', async () => {
    const { org, admin, bruna, dept, client } = await setup()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)

    const res = await app.inject({
      method: 'POST',
      url: `/columns/${column.id}/tasks`,
      headers: { authorization: await getAuthHeader(admin.email, 'Test@1234') },
      payload: { title: 'Documentação', departmentId: dept.id },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).assigneeId).toBe(bruna.id)
  })

  it('responsável escolhido explicitamente é mantido', async () => {
    const { org, admin, ana, dept, client } = await setup()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)

    const res = await app.inject({
      method: 'POST',
      url: `/columns/${column.id}/tasks`,
      headers: { authorization: await getAuthHeader(admin.email, 'Test@1234') },
      payload: { title: 'Documentação', departmentId: dept.id, assigneeId: ana.id },
    })

    expect(JSON.parse(res.body).assigneeId).toBe(ana.id)
  })

  it('recorrente gerada (manual ou pelo cron) nasce com o responsável do departamento', async () => {
    const { org, bruna, dept, client } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Apuração do Simples', periodicity: 'MONTHLY', priority: 'MEDIUM',
      competenceMonthOffset: 0, dueDayOfPeriod: 10, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createTestRecurringAssignment(template.id, org.id, { clientId: client.id })

    const { taskId } = await generateManually(template.id, assignment.id, org.id, new Date().toISOString())

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId! } })
    expect(task.assigneeId).toBe(bruna.id)
  })
})
