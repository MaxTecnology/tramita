import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn, createTestDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
  vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// Two tasks of ACME (08/2026), each with one robot delivery; documents already suggested by the robot
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { cnpj: '11222333000181' })
  const column = await createTestColumn((await createTestBoard(org.id, client.id)).id)
  const ob = await prisma.obligationType.create({ data: { code: `T-${org.id}`, name: 'Teste', organizationId: org.id } })
  const mk = async (title: string) => prisma.task.create({
    data: {
      title, columnId: column.id, departmentId: dept.id, position: 0, competence: new Date(Date.UTC(2026, 7, 1)),
      deliverables: { create: [{ name: `Guia ${title}`, position: 0, obligationTypeId: ob.id }] },
    },
    include: { deliverables: true },
  })
  const fields = (cnpj: string) => ({ cnpj: { bruto: cnpj, valor: cnpj.replace(/\D/g, ''), valido: true }, competencia: { bruto: '08/2026', valor: '2026-08', valido: true } })
  const doc = async (task: Awaited<ReturnType<typeof mk>>, cnpj: string, n: number) => prisma.receivedDocument.create({
    data: { organizationId: org.id, fileHash: `h${n}-${org.id}`, storageKey: `k/${n}-guia.pdf`, status: 'PENDING', taskId: task.id, deliverableId: task.deliverables[0].id, extractedFields: fields(cnpj) },
  })
  const a = await mk('A')
  const b = await mk('B')
  return { org, a, b, ok1: await doc(a, '11.222.333/0001-81', 1), wrongCnpj: await doc(b, '99.888.777/0001-66', 2), auth: await getAuthHeader(admin.email, 'Test@1234') }
}

describe('confirmar em lote', () => {
  it('delivers the good ones, reports each failure, and summarizes', async () => {
    const c = await setup()
    const res = await app.inject({ method: 'POST', url: '/document-reader/confirmar-lote', headers: { authorization: c.auth }, payload: { ids: [c.ok1.id, c.wrongCnpj.id] } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.summary).toMatchObject({ delivered: 1, failed: 1 })
    const byId = Object.fromEntries(body.results.map((r: { id: string }) => [r.id, r]))
    expect(byId[c.ok1.id]).toMatchObject({ ok: true, taskId: c.a.id, completion: 'READY' })
    expect(byId[c.wrongCnpj.id]).toMatchObject({ ok: false })
    expect(byId[c.wrongCnpj.id].error).toMatch(/CNPJ/)
    expect(body.summary.readyTaskIds).toEqual([c.a.id])
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: c.ok1.id } })).status).toBe('ATTACHED')
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: c.wrongCnpj.id } })).status).toBe('PENDING')
  })

  it('a document of another office in the batch is reported as not found and touches nothing', async () => {
    const c = await setup()
    const other = await setup()
    const res = await app.inject({ method: 'POST', url: '/document-reader/confirmar-lote', headers: { authorization: c.auth }, payload: { ids: [other.ok1.id] } })
    expect(JSON.parse(res.body).results[0]).toMatchObject({ ok: false, error: 'Documento não encontrado' })
    expect((await prisma.receivedDocument.findUniqueOrThrow({ where: { id: other.ok1.id } })).status).toBe('PENDING')
  })

  it('rejects an empty or oversized batch', async () => {
    const c = await setup()
    expect((await app.inject({ method: 'POST', url: '/document-reader/confirmar-lote', headers: { authorization: c.auth }, payload: { ids: [] } })).statusCode).toBe(400)
  })
})
