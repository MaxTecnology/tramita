import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import {
  loadStaffScope, getStaffScope, boardWhere, taskWhere, requestWhere, canActOnTask,
  canSeeUnidentifiedDocuments, receivedDocumentWhere, type StaffScope,
} from './staff-scope'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

afterEach(() => vi.restoreAllMocks())

const asUser = (u: { id: string; role: string; organizationId: string | null }) => ({ sub: u.id, role: u.role, organizationId: u.organizationId })

// Fiscal and Folha; client A served by Fiscal (carlos), client B by Folha (dani).
async function world() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carlos' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' })
  const gerenteFiscal = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [fiscal.id] })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
  const brunaSemColegas = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id], seesDepartmentWork: false })
  const legado = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const a = await createTestClient(org.id)
  const b = await createTestClient(org.id)
  await serveClientDepartment(a.id, fiscal.id, carlos.id)
  await serveClientDepartment(b.id, folha.id, dani.id)
  // A is also served by Folha (dani), so a Folha recurring task of A exists
  await serveClientDepartment(a.id, folha.id, dani.id)

  const osA = await createTestBoard(org.id, a.id)
  const osB = await createTestBoard(org.id, b.id)
  const colA = await createTestColumn(osA.id)
  const osTaskA = await createTestTask(colA.id, carlos.id, { departmentId: fiscal.id })
  const recA = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: a.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const recFiscalA = await createTestTask(recA.columns[0].id, carlos.id, { departmentId: fiscal.id })
  await prisma.task.update({ where: { id: recFiscalA.id }, data: { assigneeId: carlos.id } })
  const recFolhaA = await createTestTask(recA.columns[0].id, dani.id, { departmentId: folha.id })
  await prisma.task.update({ where: { id: recFolhaA.id }, data: { assigneeId: dani.id } })
  const legadoTask = await createTestTask(recA.columns[0].id, legado.id, { departmentId: folha.id })
  await prisma.task.update({ where: { id: legadoTask.id }, data: { assigneeId: legado.id } })

  const reqFiscalA = await prisma.request.create({ data: { organizationId: org.id, clientId: a.id, departmentId: fiscal.id, title: 'Pedido Fiscal' } })
  const reqFolhaB = await prisma.request.create({ data: { organizationId: org.id, clientId: b.id, departmentId: folha.id, title: 'Pedido Folha' } })

  return { org, fiscal, folha, admin, carlos, dani, gerenteFiscal, bruna, brunaSemColegas, legado, a, b, osA, osB, osTaskA, recFiscalA, recFolhaA, legadoTask, reqFiscalA, reqFolhaB }
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()

describe('loadStaffScope', () => {
  it('admin sees everything; manager always sees the department; member follows the option', async () => {
    const w = await world()
    expect(await loadStaffScope(asUser(w.admin))).toEqual({ kind: 'ALL' })
    expect(await loadStaffScope(asUser(w.gerenteFiscal))).toMatchObject({ kind: 'LIMITED', role: 'ORG_MANAGER', departmentIds: [w.fiscal.id], seesDepartment: true })
    expect(await loadStaffScope(asUser(w.bruna))).toMatchObject({ departmentIds: [w.fiscal.id], seesDepartment: true })
    expect(await loadStaffScope(asUser(w.brunaSemColegas))).toMatchObject({ seesDepartment: false })
  })
})

describe('boardWhere', () => {
  it('processes of clients served by my departments; without the option or without departments only the portfolio', async () => {
    const w = await world()
    const boards = async (u: { id: string; role: string; organizationId: string | null }) =>
      ids(await prisma.board.findMany({ where: { organizationId: w.org.id, type: 'OS', ...boardWhere(await loadStaffScope(asUser(u))) } }))

    expect(await boards(w.gerenteFiscal)).toEqual([w.osA.id])
    expect(await boards(w.bruna)).toEqual([w.osA.id])
    expect(await boards(w.brunaSemColegas)).toEqual([])
    expect(await boards(w.legado)).toEqual([]) // no departments never means "everything" nor IN ()
  })
})

describe('taskWhere', () => {
  it('recurring tasks by department, plus my own; a member without departments sees only theirs', async () => {
    const w = await world()
    const tasks = async (u: { id: string; role: string; organizationId: string | null }) =>
      ids(await prisma.task.findMany({ where: { column: { board: { organizationId: w.org.id } }, ...taskWhere(await loadStaffScope(asUser(u))) } }))

    const bruna = await tasks(w.bruna)
    expect(bruna).toContain(w.recFiscalA.id)
    expect(bruna).toContain(w.osTaskA.id)
    expect(bruna).not.toContain(w.recFolhaA.id)
    expect(await tasks(w.brunaSemColegas)).toEqual([])
    expect(await tasks(w.legado)).toEqual([w.legadoTask.id])
  })
})

describe('canActOnTask', () => {
  it('member acts on own tasks only; manager on any visible task', async () => {
    const w = await world()
    const bruna = await loadStaffScope(asUser(w.bruna))
    expect(await canActOnTask(bruna, { id: w.recFiscalA.id })).toBe(false)
    await prisma.task.update({ where: { id: w.recFiscalA.id }, data: { assigneeId: w.bruna.id } })
    expect(await canActOnTask(bruna, { id: w.recFiscalA.id })).toBe(true)
    expect(await canActOnTask(await loadStaffScope(asUser(w.gerenteFiscal)), { id: w.osTaskA.id })).toBe(true)
    expect(await canActOnTask(await loadStaffScope(asUser(w.admin)), { id: w.recFolhaA.id })).toBe(true)
  })
})

describe('requestWhere', () => {
  it('requests of my departments', async () => {
    const w = await world()
    const reqs = async (u: { id: string; role: string; organizationId: string | null }) =>
      ids(await prisma.request.findMany({ where: { organizationId: w.org.id, ...requestWhere(await loadStaffScope(asUser(u))) } }))

    expect(await reqs(w.bruna)).toEqual([w.reqFiscalA.id])
    expect(await reqs(w.gerenteFiscal)).toEqual([w.reqFiscalA.id])
    expect(await reqs(w.brunaSemColegas)).toEqual([])
    expect(await reqs(w.carlos)).toEqual([w.reqFiscalA.id]) // responsible for (A, Fiscal)
  })
})

describe('documentos do robô', () => {
  it('unidentified documents only for admin and managers; suggested task decides the rest', async () => {
    const w = await world()
    const docFiscal = await prisma.receivedDocument.create({ data: { organizationId: w.org.id, fileHash: 'h1', storageKey: 'k1', status: 'PENDING', taskId: w.recFiscalA.id } })
    const docSolto = await prisma.receivedDocument.create({ data: { organizationId: w.org.id, fileHash: 'h2', storageKey: 'k2', status: 'NOT_IDENTIFIED' } })
    const docs = async (scope: StaffScope) => ids(await prisma.receivedDocument.findMany({ where: { organizationId: w.org.id, ...receivedDocumentWhere(scope) } }))

    const gerente = await loadStaffScope(asUser(w.gerenteFiscal))
    expect(canSeeUnidentifiedDocuments(gerente)).toBe(true)
    expect(await docs(gerente)).toEqual(ids([docFiscal, docSolto]))
    const bruna = await loadStaffScope(asUser(w.bruna))
    expect(canSeeUnidentifiedDocuments(bruna)).toBe(false)
    expect(await docs(bruna)).toEqual([docFiscal.id])
  })
})

describe('getStaffScope', () => {
  it('reads the database once per request', async () => {
    const w = await world()
    const spy = vi.spyOn(prisma.user, 'findUnique')
    const request = { user: asUser(w.bruna) } as unknown as FastifyRequest

    await getStaffScope(request)
    await getStaffScope(request)

    expect(spy).toHaveBeenCalledTimes(1)
  })
})
