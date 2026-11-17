import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn, createTestDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// ACME (11.222.333/0001-81) task 08/2026 with "Guia" (robot) and "Extrato" (no robot); BETA is another client
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const dept = await createTestDepartment(org.id)
  const acme = await createTestClient(org.id, { name: 'ACME', cnpj: '11222333000181' })
  await createTestClient(org.id, { name: 'BETA', cnpj: '45723174000110' })
  const column = await createTestColumn((await createTestBoard(org.id, acme.id)).id)
  const ob = await prisma.obligationType.create({ data: { code: `T-${org.id}`, name: 'DAS', organizationId: org.id } })
  await prisma.documentModel.create({
    data: {
      organizationId: org.id, obligationTypeId: ob.id, name: `Modelo ${org.id}`,
      definicao: {
        tipoImposto: `T-${org.id}`,
        ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
        zonas: [
          { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
          { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
        ],
      },
    },
  })
  const task = await prisma.task.create({
    data: {
      title: 'Apuração', columnId: column.id, departmentId: dept.id, position: 0, competence: new Date(Date.UTC(2026, 7, 1)),
      deliverables: { create: [{ name: 'Guia', position: 0, obligationTypeId: ob.id }, { name: 'Extrato', position: 1 }] },
    },
    include: { deliverables: { orderBy: { position: 'asc' } } },
  })
  return { task, guia: task.deliverables[0], extrato: task.deliverables[1], auth: await getAuthHeader(admin.email, 'Test@1234') }
}

type Ctx = Awaited<ReturnType<typeof setup>>
const pdf = async (cnpj: string, comp: string) => Buffer.from(await gerarPdfComDocumentoArrecadacao(cnpj, comp))

// Binary-safe multipart (a PDF must reach the API byte for byte): text fields first, then the file
function multipart(fields: Record<string, string>, filename: string, content: Buffer, contentType: string) {
  const boundary = `b-${Math.random().toString(36).slice(2)}`
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--`))
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) }
}

async function send(c: Ctx, kind: 'check' | 'upload', deliverableId: string, content: Buffer, extra: Record<string, string> = {}, filename = 'guia.pdf') {
  const mp = multipart(extra, filename, content, filename.endsWith('.pdf') ? 'application/pdf' : 'image/png')
  const url = kind === 'check'
    ? `/tasks/${c.task.id}/documents/deliveries/${deliverableId}/check`
    : `/tasks/${c.task.id}/documents/deliveries/${deliverableId}/upload`
  const res = await app.inject({ method: 'POST', url, headers: { authorization: c.auth, ...mp.headers }, body: mp.body })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

describe('robô confere a entrega manual', () => {
  it('everything matches: no warning, delivered straight away', async () => {
    const c = await setup()
    const doc = await pdf('11.222.333/0001-81', 'agosto/2026')
    expect((await send(c, 'check', c.guia.id, doc)).body).toMatchObject({ warnings: [] })
    expect((await send(c, 'upload', c.guia.id, doc)).status).toBe(201)
  })

  it('a document of another client of the office is blocked, even if one insists', async () => {
    const c = await setup()
    const doc = await pdf('45.723.174/0001-10', 'agosto/2026')
    const check = await send(c, 'check', c.guia.id, doc)
    expect(check.body.blocked).toBe('Este documento é de BETA — não pode ser entregue a ACME')
    const up = await send(c, 'upload', c.guia.id, doc, { acceptWarnings: 'true' })
    expect(up.status).toBe(422)
    expect((await prisma.taskDeliverable.findUniqueOrThrow({ where: { id: c.guia.id } })).deliveredAt).toBeNull()
  })

  it('another competence warns; delivering anyway needs the confirmation and goes to the history', async () => {
    const c = await setup()
    const doc = await pdf('11.222.333/0001-81', 'setembro/2026')
    expect((await send(c, 'check', c.guia.id, doc)).body.warnings).toEqual(['Competência do documento: 09/2026 — a tarefa é de 08/2026'])
    expect((await send(c, 'upload', c.guia.id, doc)).status).toBe(409)
    expect((await send(c, 'upload', c.guia.id, doc, { acceptWarnings: 'true' })).status).toBe(201)
    const h = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: c.task.id, action: 'deliverable_delivered_with_warnings' } })
    expect([h.actorName, h.fromValue, h.toValue]).toEqual(['Bruna', 'Guia', 'guia.pdf — Competência do documento: 09/2026 — a tarefa é de 08/2026'])
  })

  it('a CNPJ that is no client of the office and an unreadable file are warnings', async () => {
    const c = await setup()
    expect((await send(c, 'check', c.guia.id, await pdf('11.444.777/0001-61', 'agosto/2026'))).body.warnings).toEqual(['O CNPJ do documento (11.444.777/0001-61) não é de nenhum cliente do escritório'])
    expect((await send(c, 'check', c.guia.id, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), {}, 'foto.png')).body.warnings).toEqual(['O robô não conseguiu conferir este arquivo'])
  })

  it('a delivery without robot is not checked', async () => {
    const c = await setup()
    expect((await send(c, 'check', c.extrato.id, await pdf('45.723.174/0001-10', 'setembro/2026'))).body).toEqual({ warnings: [], read: {} })
  })

  it('replacing the file of the protocol goes through the same check (no bypass through "Protocolos")', async () => {
    const c = await setup()
    expect((await send(c, 'upload', c.guia.id, await pdf('11.222.333/0001-81', 'agosto/2026'))).status).toBe(201)
    const protocol = await prisma.protocol.findFirstOrThrow({ where: { deliverableId: c.guia.id } })
    const replace = async (content: Buffer, extra: Record<string, string> = {}) => {
      const mp = multipart(extra, 'nova.pdf', content, 'application/pdf')
      const res = await app.inject({ method: 'POST', url: `/protocols/${protocol.id}/replace`, headers: { authorization: c.auth, ...mp.headers }, body: mp.body })
      return { status: res.statusCode, body: JSON.parse(res.body) }
    }
    const beta = await replace(await pdf('45.723.174/0001-10', 'agosto/2026'), { acceptWarnings: 'true' })
    expect([beta.status, beta.body.message]).toEqual([422, 'Este documento é de BETA — não pode ser entregue a ACME'])
    const wrongMonth = await pdf('11.222.333/0001-81', 'setembro/2026')
    expect((await replace(wrongMonth)).status).toBe(409)
    expect((await replace(wrongMonth, { acceptWarnings: 'true' })).status).toBe(200)
    const h = await prisma.taskHistory.findFirstOrThrow({ where: { taskId: c.task.id, action: 'deliverable_delivered_with_warnings' } })
    expect([h.fromValue, h.toValue]).toEqual(['Guia', 'nova.pdf — Competência do documento: 09/2026 — a tarefa é de 08/2026'])
  })
})
