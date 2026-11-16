import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import * as coverage from '@/modules/clients/client-coverage'
import { ensureServiceSystemBoard, ensureRecurringSystemBoard } from '@/modules/tasks/tasks.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

const at = (s: string) => new Date(`${s}T13:00:00.000Z`)
const json = (r: { body: string }) => JSON.parse(r.body)

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Caio' })
  await prisma.user.update({ where: { id: member.id }, data: { seesDepartmentWork: false } })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, dept.id, admin.id)
  const model = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Recálculo', deadlineBusinessDays: 3, usableStandalone: true, usableInProcess: true } })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  const memberAuth = await getAuthHeader(member.email, 'Test@1234')
  return { org, admin, member, dept, client, model, auth, memberAuth }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const COLUMNS = [
  { title: 'Análise', statusEffect: 'OPEN', documents: [] },
  { title: 'Prefeitura', statusEffect: 'NONE', documents: [] },
  { title: 'Feito', statusEffect: 'DONE', documents: [] },
]
async function openProcess(c: Ctx, items: object[] = [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }]) {
  const t = json(await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'P', columns: COLUMNS, items } }))
  return app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })
}
const openOS = async (c: Ctx) => json(await app.inject({ method: 'POST', url: '/os', headers: { authorization: c.auth }, payload: { osModelId: c.model.id, clientId: c.client.id } })) as { id: string }

describe('tempo por etapa sobrevive a renomear a coluna', () => {
  it('the move history keeps the column id, so a renamed column keeps its time', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const cols = await prisma.column.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } })
    for (const col of [cols[1], cols[2]]) {
      const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}/move`, headers: { authorization: c.auth }, payload: { columnId: col.id, position: 0 } })
      expect(res.statusCode).toBe(200)
    }
    const moves = await prisma.taskHistory.findMany({ where: { taskId: os.id, action: 'moved_to' }, orderBy: { createdAt: 'asc' } })
    expect(moves.map((m) => [m.fromColumnId, m.toColumnId])).toEqual([[cols[0].id, cols[1].id], [cols[1].id, cols[2].id]])
    await prisma.task.update({ where: { id: os.id }, data: { createdAt: at('2026-11-16'), releasedAt: at('2026-11-16'), completedAt: at('2026-11-23') } })
    await prisma.taskHistory.update({ where: { id: moves[0].id }, data: { createdAt: at('2026-11-18') } })
    await prisma.taskHistory.update({ where: { id: moves[1].id }, data: { createdAt: at('2026-11-23') } })
    await prisma.column.update({ where: { id: cols[1].id }, data: { title: 'Prefeitura (protocolo)' } })

    const res = json(await app.inject({ method: 'GET', url: `/boards/${board.id}/stage-times`, headers: { authorization: c.auth } }))
    expect(res.columns.map((col: { title: string; totalBusinessDays: number }) => [col.title, col.totalBusinessDays]))
      .toEqual([['Análise', 2], ['Prefeitura (protocolo)', 2], ['Feito', 0]])
  })
})

describe('concluir pelo drawer move o cartão', () => {
  it('finishing a process OS by status puts it in the done column, with the move in the history', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const done = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, statusEffect: 'DONE' } })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).columnId).toBe(done.id)
    const move = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: os.id, action: 'moved_to' } })
    expect([move.fromValue, move.toValue, move.toColumnId]).toEqual(['Análise', 'Feito', done.id])
  })

  it('reopening a task that sits in the done column takes it back to the first column', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const cols = await prisma.column.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } })
    await app.inject({ method: 'PATCH', url: `/tasks/${os.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}`, headers: { authorization: c.auth }, payload: { status: 'OPEN' } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).columnId).toBe(cols[0].id)
  })
})

describe('motivo de atraso respeita a carteira', () => {
  it('a member cannot register the reason of an OS or process outside their portfolio', async () => {
    const c = await setup()
    const os = await openOS(c)
    const board = json(await openProcess(c))
    const [reason] = json(await app.inject({ method: 'GET', url: '/delay-reasons', headers: { authorization: c.auth } })) as { id: string }[]
    const onTask = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}/delay-reason`, headers: { authorization: c.memberAuth }, payload: { delayReasonId: reason.id } })
    const onBoard = await app.inject({ method: 'PATCH', url: `/boards/${board.id}/delay-reason`, headers: { authorization: c.memberAuth }, payload: { delayReasonId: reason.id } })
    expect([onTask.statusCode, onBoard.statusCode]).toEqual([404, 404])
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).delayReasonId).toBeNull()
  })
})

describe('OS adicionada a processo com dependência concluída no meio', () => {
  it('is released when its dependency finished between the check and the write', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const first = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const col = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, position: 1 } })
    const original = coverage.lockClients
    vi.spyOn(coverage, 'lockClients').mockImplementation(async (tx, ids) => {
      // The dependency is finished by someone else right after it was read as open
      await prisma.task.update({ where: { id: first.id }, data: { status: 'DONE', completedAt: new Date() } })
      return original(tx, ids)
    })
    const res = await app.inject({ method: 'POST', url: `/boards/${board.id}/os`, headers: { authorization: c.auth }, payload: { osModelId: c.model.id, columnId: col.id, dependsOnTaskIds: [first.id] } })
    expect(res.statusCode).toBe(201)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: json(res).id } })).releasedAt).not.toBeNull()
  })
})

describe('board de serviços do cliente é único', () => {
  it('two first OS at the same time share one services board', async () => {
    const c = await setup()
    const boards = await Promise.all([1, 2, 3].map(() => ensureServiceSystemBoard(c.client.id, c.org.id)))
    expect(new Set(boards.map((b) => b.id)).size).toBe(1)
    expect(await prisma.board.count({ where: { clientId: c.client.id, type: 'SERVICE_SYSTEM' } })).toBe(1)
    expect(boards[0].columns).toHaveLength(4)
  })
})

describe('board de recorrentes do cliente é único', () => {
  it('concurrent first generations share one recurring board', async () => {
    const c = await setup()
    const boards = await Promise.all([1, 2, 3].map(() => ensureRecurringSystemBoard(c.client.id, c.org.id)))
    expect(new Set(boards.map((b) => b.id)).size).toBe(1)
    expect(await prisma.board.count({ where: { clientId: c.client.id, type: 'RECURRING_SYSTEM' } })).toBe(1)
    expect(boards[0].columns).toHaveLength(1)
  })

  it('a recurring board left without columns gets its column back instead of a second board', async () => {
    const c = await setup()
    const bare = await prisma.board.create({ data: { title: 'Rec', organizationId: c.org.id, clientId: c.client.id, type: 'RECURRING_SYSTEM' } })
    const board = await ensureRecurringSystemBoard(c.client.id, c.org.id)
    expect(board.id).toBe(bare.id)
    expect(board.columns).toHaveLength(1)
    expect(await prisma.board.count({ where: { clientId: c.client.id, type: 'RECURRING_SYSTEM' } })).toBe(1)
  })
})

describe('feriado cadastrado depois', () => {
  it('moves the target of the open OS whose window covers it, and removing it moves back', async () => {
    const c = await setup()
    const os = await openOS(c)
    // Released Monday 07/12/2026, 3 business days → Thursday 10/12
    await prisma.task.update({ where: { id: os.id }, data: { releasedAt: at('2026-12-07'), targetDate: new Date('2026-12-10T00:00:00.000Z') } })
    const finished = await openOS(c)
    await prisma.task.update({ where: { id: finished.id }, data: { releasedAt: at('2026-12-07'), targetDate: new Date('2026-12-10T00:00:00.000Z'), status: 'DONE', completedAt: at('2026-12-09') } })
    const target = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).targetDate?.toISOString().slice(0, 10)

    const created = await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.auth }, payload: { date: '2026-12-08', name: 'Padroeira' } })
    expect(created.statusCode).toBe(201)
    expect(await target(os.id)).toBe('2026-12-11')
    expect(await target(finished.id)).toBe('2026-12-10')

    const removed = await app.inject({ method: 'DELETE', url: `/holidays/${json(created).id}`, headers: { authorization: c.auth } })
    expect(removed.statusCode).toBeLessThan(300)
    expect(await target(os.id)).toBe('2026-12-10')
  })

  it('also moves the target of an open process', async () => {
    const c = await setup()
    const t = json(await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'P', columns: COLUMNS, deadlineBusinessDays: 3, items: [] } }))
    const board = json(await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } }))
    await prisma.board.update({ where: { id: board.id }, data: { createdAt: at('2026-12-07'), targetDate: new Date('2026-12-10T00:00:00.000Z') } })
    await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.auth }, payload: { date: '2026-12-08', name: 'Padroeira' } })
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).targetDate?.toISOString().slice(0, 10)).toBe('2026-12-11')
  })
})

describe('abrir processo revalida o uso da OS', () => {
  it('an item whose model stopped being used in processes refuses the opening', async () => {
    const c = await setup()
    const t = json(await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.auth }, payload: { name: 'P', columns: COLUMNS, items: [{ osModelId: c.model.id, columnIndex: 0, dependsOn: [] }] } }))
    await prisma.oSModel.update({ where: { id: c.model.id }, data: { usableInProcess: false } })
    const res = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.auth }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })
    expect([res.statusCode, json(res).message]).toEqual([422, 'Essa OS não é usada em processos'])
    expect(await prisma.board.count({ where: { clientId: c.client.id, type: 'PROCESS' } })).toBe(0)
  })
})

describe('cliente só é avisado da OS quando ela começa', () => {
  it('an OS waiting for another one is announced when released, not when created', async () => {
    const c = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
    const board = json(await openProcess(c, [
      { osModelId: c.model.id, columnIndex: 0, dependsOn: [] },
      { osModelId: c.model.id, columnIndex: 1, dependsOn: [0] },
    ]))
    const [first, second] = await prisma.task.findMany({ where: { column: { boardId: board.id } }, orderBy: { position: 'asc' }, include: { column: true } })
    const waiting = first.releasedAt ? second : first
    const dependency = first.releasedAt ? first : second
    const created = (taskId: string) => spy.mock.calls.filter(([job]) => job.event === 'TASK_CREATED' && job.taskId === taskId).length
    expect([created(dependency.id), created(waiting.id)]).toEqual([1, 0])

    await app.inject({ method: 'PATCH', url: `/tasks/${dependency.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: waiting.id } })).releasedAt).not.toBeNull()
    expect(created(waiting.id)).toBe(1)
  })
})

describe('falhas depois do commit não derrubam a operação', () => {
  it('the queue failing on the release announcement still finishes the OS and releases every dependent', async () => {
    const c = await setup()
    const board = json(await openProcess(c, [
      { osModelId: c.model.id, columnIndex: 0, dependsOn: [] },
      { osModelId: c.model.id, columnIndex: 1, dependsOn: [0] },
      { osModelId: c.model.id, columnIndex: 1, dependsOn: [0] },
    ]))
    const tasks = await prisma.task.findMany({ where: { column: { boardId: board.id } } })
    const dependency = tasks.find((t) => t.releasedAt)!
    vi.spyOn(queue, 'enqueueNotification').mockImplementation(async (job) => {
      if (job.event === 'TASK_CREATED') throw new Error('Redis fora do ar')
    })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${dependency.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    const waiting = await prisma.task.findMany({ where: { column: { boardId: board.id }, id: { not: dependency.id } } })
    expect(waiting.every((t) => t.releasedAt !== null)).toBe(true)
  })

  it('a holiday is saved even if recomputing the targets fails', async () => {
    const c = await setup()
    const deadline = await import('@/modules/os/os-deadline.service')
    vi.spyOn(deadline, 'rescheduleAroundHoliday').mockRejectedValue(new Error('timeout'))
    const res = await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.auth }, payload: { date: '2026-12-08', name: 'Padroeira' } })
    expect(res.statusCode).toBe(201)
  })
})

describe('reordenar não troca de coluna', () => {
  it('reorder only changes positions inside the current column; changing column goes through /move', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const done = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, statusEffect: 'DONE' } })
    const moved = await app.inject({ method: 'PATCH', url: '/tasks/reorder', headers: { authorization: c.auth }, payload: [{ id: os.id, columnId: done.id, position: 0 }] })
    expect([moved.statusCode, json(moved).message]).toEqual([400, 'Para trocar de coluna, mova a tarefa'])
    const after = await prisma.task.findUniqueOrThrow({ where: { id: os.id } })
    expect([after.columnId, after.status]).toEqual([os.columnId, os.status])
    const same = await app.inject({ method: 'PATCH', url: '/tasks/reorder', headers: { authorization: c.auth }, payload: [{ id: os.id, columnId: os.columnId, position: 5 }] })
    expect(same.statusCode).toBe(200)
    expect((await prisma.task.findUniqueOrThrow({ where: { id: os.id } })).position).toBe(5)
  })
})

describe('concluir pelo drawer com move concorrente', () => {
  it('a card moved by someone else meanwhile is not dragged back; the history uses where it really was', async () => {
    const c = await setup()
    const board = json(await openProcess(c))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const cols = await prisma.column.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } })
    const gate = await import('@/modules/approvals/approval-gate')
    const original = gate.assertNoPendingApproval
    vi.spyOn(gate, 'assertNoPendingApproval').mockImplementation(async (tx, taskId) => {
      // Someone moved it to "Prefeitura" while this request was on its way
      await prisma.task.update({ where: { id: os.id }, data: { columnId: cols[1].id } })
      return original(tx, taskId)
    })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${os.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    const move = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: os.id, action: 'moved_to' } })
    expect([move.fromColumnId, move.fromValue, move.toColumnId]).toEqual([cols[1].id, 'Prefeitura', cols[2].id])
  })
})

describe('liberar dependentes é isolado por OS', () => {
  it('a failure releasing one dependent does not stop the others', async () => {
    const c = await setup()
    const board = json(await openProcess(c, [
      { osModelId: c.model.id, columnIndex: 0, dependsOn: [] },
      { osModelId: c.model.id, columnIndex: 1, dependsOn: [0] },
      { osModelId: c.model.id, columnIndex: 1, dependsOn: [0] },
    ]))
    const tasks = await prisma.task.findMany({ where: { column: { boardId: board.id } } })
    const dependency = tasks.find((t) => t.releasedAt)!
    const docs = await import('@/modules/task-documents/task-documents.service')
    const original = docs.recalculateTaskStatus
    let calls = 0
    vi.spyOn(docs, 'recalculateTaskStatus').mockImplementation(async (...args) => {
      if (tasks.some((t) => t.id === args[0] && t.id !== dependency.id) && calls++ === 0) throw new Error('falha no primeiro')
      return original(...args)
    })
    const res = await app.inject({ method: 'PATCH', url: `/tasks/${dependency.id}`, headers: { authorization: c.auth }, payload: { status: 'DONE' } })
    expect(res.statusCode).toBe(200)
    // The failing one goes back to waiting (no half-released OS without target); the other is released
    const others = await prisma.task.findMany({ where: { column: { boardId: board.id }, id: { not: dependency.id } } })
    expect(others.filter((t) => t.releasedAt !== null)).toHaveLength(1)
    const stuck = others.find((t) => t.releasedAt === null)!
    expect(await prisma.taskHistory.count({ where: { taskId: stuck.id, action: 'os_released' } })).toBe(0)
  })
})
