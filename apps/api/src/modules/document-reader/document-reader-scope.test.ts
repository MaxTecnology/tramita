import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import * as readerQueue from '@/lib/document-reader-queue'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed')
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(readerQueue, 'enqueueDocumentReader').mockResolvedValue()
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
  const gerente = await createTestUser(org.id, { role: 'ORG_MANAGER', departmentIds: [fiscal.id] })
  const a = await createTestClient(org.id)
  await serveClientDepartment(a.id, fiscal.id, carlos.id)
  await serveClientDepartment(a.id, folha.id, dani.id)
  const board = await createTestBoard(org.id, a.id)
  const col = await createTestColumn(board.id)
  const fiscalTask = await createTestTask(col.id, admin.id, { departmentId: fiscal.id })
  const folhaTask = await createTestTask(col.id, admin.id, { departmentId: folha.id })
  await prisma.task.update({ where: { id: fiscalTask.id }, data: { assigneeId: carlos.id } })
  await prisma.task.update({ where: { id: folhaTask.id }, data: { assigneeId: dani.id } })
  // Recurring board: department reach applies to recurring tasks (OS processes are visible whole)
  const rec = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: a.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
  const recFolha = await createTestTask(rec.columns[0].id, admin.id, { departmentId: folha.id })
  const doc = (taskId: string | null, status: 'PENDING' | 'NOT_IDENTIFIED' | 'REJECTED' = 'PENDING') =>
    prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: `h-${Math.random()}`, storageKey: 'document-reader/x/1-doc.pdf', status, taskId } })
  return {
    fiscalTask, folhaTask, recFolha, doc,
    brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'),
    gerenteAuth: await getAuthHeader(gerente.email, 'Test@1234'),
  }
}

const ids = (body: string) => (JSON.parse(body) as { id: string }[]).map((d) => d.id).sort()

describe('fila do robô no escopo do colaborador', () => {
  it('member sees documents suggested for tasks of their department, not of others nor unidentified', async () => {
    const c = await setup()
    const fiscalDoc = await c.doc(c.fiscalTask.id)
    const recFolhaDoc = await c.doc(c.recFolha.id)
    const loose = await c.doc(null, 'NOT_IDENTIFIED')

    const bruna = ids((await app.inject({ method: 'GET', url: '/document-reader/fila', headers: { authorization: c.brunaAuth } })).body)
    const gerente = ids((await app.inject({ method: 'GET', url: '/document-reader/fila', headers: { authorization: c.gerenteAuth } })).body)

    expect(bruna).toContain(fiscalDoc.id)
    expect(bruna).not.toContain(recFolhaDoc.id)
    expect(bruna).not.toContain(loose.id)
    expect(gerente).toContain(loose.id) // managers triage the unidentified
  })

  it('"mine" shows only documents suggested for my tasks', async () => {
    const c = await setup()
    const fiscalDoc = await c.doc(c.fiscalTask.id)
    const res = await app.inject({ method: 'GET', url: '/document-reader/fila?scope=mine', headers: { authorization: c.brunaAuth } })
    expect(ids(res.body)).not.toContain(fiscalDoc.id) // carlos' task
  })

  it('view, confirm and reject a document out of scope answer 404', async () => {
    const c = await setup()
    const recFolhaDoc = await c.doc(c.recFolha.id)
    const call = (method: 'GET' | 'POST', url: string) => app.inject({ method, url, headers: { authorization: c.brunaAuth }, payload: method === 'POST' ? {} : undefined })
    expect((await call('GET', `/document-reader/${recFolhaDoc.id}/visualizar`)).statusCode).toBe(404)
    expect((await call('POST', `/document-reader/${recFolhaDoc.id}/confirmar`)).statusCode).toBe(404)
    expect((await call('POST', `/document-reader/${recFolhaDoc.id}/rejeitar`)).statusCode).toBe(404)
  })

  it("confirming into a colleague's task requires assuming it first (403)", async () => {
    const c = await setup()
    const fiscalDoc = await c.doc(c.fiscalTask.id)
    const res = await app.inject({ method: 'POST', url: `/document-reader/${fiscalDoc.id}/confirmar`, headers: { authorization: c.brunaAuth }, payload: {} })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).message).toBe('Assuma a tarefa para alterá-la')
  })

  it('members cannot upload to the reader; managers can', async () => {
    const c = await setup()
    const up = (auth: string) => {
      const mp = multipartBody({}, { filename: 'guia.pdf', content: '%PDF-1.4' })
      return app.inject({ method: 'POST', url: '/document-reader/upload', headers: { authorization: auth, ...mp.headers }, body: mp.body })
    }
    expect((await up(c.brunaAuth)).statusCode).toBe(403)
    expect((await up(c.gerenteAuth)).statusCode).toBe(201)
  })

  it('document whose suggested task was deleted leaves the member queue without errors', async () => {
    const c = await setup()
    const fiscalDoc = await c.doc(c.fiscalTask.id)
    await prisma.receivedDocument.update({ where: { id: fiscalDoc.id }, data: { taskId: null } })
    await prisma.task.delete({ where: { id: c.fiscalTask.id } })
    const res = await app.inject({ method: 'GET', url: '/document-reader/fila', headers: { authorization: c.brunaAuth } })
    expect(res.statusCode).toBe(200)
    expect(ids(res.body)).not.toContain(fiscalDoc.id)
  })
})
