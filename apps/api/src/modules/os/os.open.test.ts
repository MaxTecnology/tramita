import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as b2Module from '@/lib/b2'
import * as queue from '@/lib/queue'
import { processarDocumento } from '@/modules/document-reader/document-reader.service'
import { deliverDocument } from '@/modules/task-documents/task-documents.service'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined as never)
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN', name: 'Bruna' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dept = await createTestDepartment(org.id)
  const client = await createTestClient(org.id, { name: 'ACME', cnpj: '11222333000181' })
  await serveClientDepartment(client.id, dept.id, admin.id)
  const das = await prisma.obligationType.create({ data: { code: `DAS-${org.id}`, name: 'DAS', organizationId: org.id } })
  const recalculo = await prisma.oSModel.create({
    data: {
      organizationId: org.id, departmentId: dept.id, name: 'Recálculo DAS', requiresCompetence: true, deadlineBusinessDays: 3,
      autoCompleteOnAllDelivered: true, usableStandalone: true,
      documentRequests: { create: [{ name: 'Extrato', position: 0 }] },
      documentDeliveries: { create: [{ name: 'Guia DAS recalculada', position: 0, obligationTypeId: das.id }] },
    },
  })
  const junta = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Registro na Junta', usableStandalone: false, usableInProcess: true } })
  const inscricao = await prisma.oSModel.create({ data: { organizationId: org.id, departmentId: dept.id, name: 'Inscrição municipal', usableStandalone: true, usableInProcess: true } })
  return {
    org, client, dept, das, recalculo, junta, inscricao,
    admin: await getAuthHeader(admin.email, 'Test@1234'), member: await getAuthHeader(member.email, 'Test@1234'),
  }
}
type Ctx = Awaited<ReturnType<typeof setup>>
const openOS = (c: Ctx, payload: object, auth = c.admin) => app.inject({ method: 'POST', url: '/os', headers: { authorization: auth }, payload })
const json = (r: { body: string }) => JSON.parse(r.body)

describe('abrir OS avulsa', () => {
  it('opens in the client services board with the model documents, robot, competence and deadline', async () => {
    const c = await setup()
    const res = await openOS(c, { osModelId: c.recalculo.id, clientId: c.client.id, competence: '2025-03' })
    expect(res.statusCode).toBe(201)
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: json(res).id },
      include: { column: { include: { board: true } }, documentRequirements: true, deliverables: true },
    })
    expect(task.column.board.type).toBe('SERVICE_SYSTEM')
    expect(task.title).toBe('Recálculo DAS — 03/2025')
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2025-03-01')
    expect([task.osModelId, task.deadlineBusinessDays, task.status]).toEqual([c.recalculo.id, 3, 'BLOCKED'])
    expect(task.releasedAt).not.toBeNull()
    expect(task.targetDate).not.toBeNull()
    expect(task.documentRequirements.map((d) => d.name)).toEqual(['Extrato'])
    expect(task.deliverables.map((d) => [d.name, d.obligationTypeId])).toEqual([['Guia DAS recalculada', c.das.id]])

    const second = await openOS(c, { osModelId: c.inscricao.id, clientId: c.client.id })
    const t2 = await prisma.task.findUniqueOrThrow({ where: { id: json(second).id }, include: { column: true } })
    expect(t2.column.boardId).toBe(task.column.boardId)
    expect(t2.title).toBe('Inscrição municipal')
  })

  it('a model that asks for the competence refuses opening without it', async () => {
    const c = await setup()
    const res = await openOS(c, { osModelId: c.recalculo.id, clientId: c.client.id })
    expect([res.statusCode, json(res).message]).toEqual([422, 'Informe a competência'])
  })

  it('a process-only OS cannot be opened standalone', async () => {
    const c = await setup()
    const res = await openOS(c, { osModelId: c.junta.id, clientId: c.client.id })
    expect([res.statusCode, json(res).message]).toEqual([422, 'Essa OS é só de processo'])
  })

  it('a member cannot open an OS for a client outside their portfolio', async () => {
    const c = await setup()
    const res = await openOS(c, { osModelId: c.inscricao.id, clientId: c.client.id }, c.member)
    expect([res.statusCode, json(res).message]).toEqual([404, 'Cliente não encontrado'])
  })

  it('the robot recognizes the PDF of the recalculation and suggests the OS delivery', async () => {
    const c = await setup()
    const os = json(await openOS(c, { osModelId: c.recalculo.id, clientId: c.client.id, competence: '2025-03' }))
    await prisma.documentModel.create({
      data: {
        organizationId: c.org.id, obligationTypeId: c.das.id, name: `Modelo ${c.org.id}`,
        definicao: {
          tipoImposto: `DAS-${c.org.id}`,
          ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
          zonas: [
            { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
            { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
          ],
        },
      },
    })
    const doc = await prisma.receivedDocument.create({ data: { organizationId: c.org.id, fileHash: `h-${c.org.id}`, storageKey: `k/${c.org.id}/1-guia.pdf`, status: 'PENDING' } })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'março/2025')))
    await processarDocumento(doc.id)
    const read = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    const guia = await prisma.taskDeliverable.findFirstOrThrow({ where: { taskId: os.id } })
    expect([read.taskId, read.deliverableId]).toEqual([os.id, guia.id])
  })

  it('the robot also recognizes the delivery of an OS inside a process (and the queue names the process)', async () => {
    const c = await setup()
    await prisma.oSModel.update({ where: { id: c.recalculo.id }, data: { usableInProcess: true } })
    const t = json(await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.admin }, payload: { name: 'Regularização', columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }], items: [{ osModelId: c.recalculo.id, columnIndex: 0, dependsOn: [] }] } }))
    const board = json(await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'Regularização ACME', clientId: c.client.id, processTemplateId: t.id, competence: '2025-03' } }))
    const os = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    await prisma.documentModel.create({
      data: {
        organizationId: c.org.id, obligationTypeId: c.das.id, name: `Modelo ${c.org.id}`,
        definicao: {
          tipoImposto: `DAS-${c.org.id}`,
          ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
          zonas: [
            { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
            { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
          ],
        },
      },
    })
    const doc = await prisma.receivedDocument.create({ data: { organizationId: c.org.id, fileHash: `p-${c.org.id}`, storageKey: `k/${c.org.id}/2-guia.pdf`, status: 'PENDING' } })
    vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from(await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'março/2025')))
    await processarDocumento(doc.id)
    const read = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(read.taskId).toBe(os.id)
    const { listarFilaDeRevisao } = await import('@/modules/document-reader/document-reader.service')
    const [item] = await listarFilaDeRevisao(c.org.id)
    expect(item.suggestion).toMatchObject({ processTitle: 'Regularização ACME' })
  })

  it('a model configured to complete by itself completes the OS when everything is delivered', async () => {
    const c = await setup()
    const os = json(await openOS(c, { osModelId: c.recalculo.id, clientId: c.client.id, competence: '2025-03' }))
    await prisma.taskDocumentRequirement.updateMany({ where: { taskId: os.id }, data: { status: 'NOT_APPLICABLE' } })
    const guia = await prisma.taskDeliverable.findFirstOrThrow({ where: { taskId: os.id } })
    const admin = await prisma.user.findFirstOrThrow({ where: { organizationId: c.org.id, role: 'ORG_ADMIN' } })
    const out = await deliverDocument(os.id, guia.id, c.org.id, { id: admin.id }, { filename: 'guia.pdf', mimeType: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') })
    expect(out.completion).toBe('AUTO_COMPLETED')
  })

  it('removing a model already used deactivates it instead', async () => {
    const c = await setup()
    await openOS(c, { osModelId: c.inscricao.id, clientId: c.client.id })
    expect((await app.inject({ method: 'DELETE', url: `/os-models/${c.inscricao.id}`, headers: { authorization: c.admin } })).statusCode).toBe(200)
    expect((await prisma.oSModel.findUniqueOrThrow({ where: { id: c.inscricao.id } })).isActive).toBe(false)
  })
})

describe('abrir processo com OS', () => {
  const columns = [
    { title: 'Abertura', statusEffect: 'OPEN', notifyClient: false, documents: [] },
    { title: 'Registro', statusEffect: 'NONE', notifyClient: false, documents: [] },
    { title: 'Concluído', statusEffect: 'DONE', notifyClient: false, documents: [] },
  ]
  async function template(c: Ctx, items: object[]) {
    return app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.admin }, payload: { name: 'Abertura', columns, deadlineBusinessDays: 30, items } })
  }

  it('creates the board with one OS per item in its column, waiting for its dependencies', async () => {
    const c = await setup()
    const t = await template(c, [
      { osModelId: c.inscricao.id, columnIndex: 0, dependsOn: [] },
      { osModelId: c.junta.id, columnIndex: 1, dependsOn: [0] },
      { osModelId: c.inscricao.id, columnIndex: 1, dependsOn: [0, 1] },
    ])
    expect(t.statusCode).toBe(201)
    expect(json(t).items.map((i: { osModel: { name: string }; columnPosition: number; dependsOn: number[] }) => [i.osModel.name, i.columnPosition, i.dependsOn]))
      .toEqual([['Inscrição municipal', 0, []], ['Registro na Junta', 1, [0]], ['Inscrição municipal', 1, [0, 1]]])

    const res = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'Abertura ACME', clientId: c.client.id, processTemplateId: json(t).id } })
    expect(res.statusCode).toBe(201)
    const board = await prisma.board.findUniqueOrThrow({ where: { id: json(res).id }, include: { columns: { orderBy: { position: 'asc' }, include: { tasks: { orderBy: { position: 'asc' } } } } } })
    expect(board.deadlineBusinessDays).toBe(30)
    const [a] = board.columns[0].tasks
    const [b, cc] = board.columns[1].tasks
    expect([a.title, b.title, cc.title]).toEqual(['Inscrição municipal', 'Registro na Junta', 'Inscrição municipal'])
    expect(a.releasedAt).not.toBeNull()
    expect([b.releasedAt, cc.releasedAt]).toEqual([null, null])
    const deps = await prisma.taskDependency.findMany({ where: { taskId: cc.id } })
    expect(deps.map((d) => d.dependsOnTaskId).sort()).toEqual([a.id, b.id].sort())
  })

  it('refuses a dependency cycle and an OS not used in processes', async () => {
    const c = await setup()
    const cycle = await template(c, [
      { osModelId: c.inscricao.id, columnIndex: 0, dependsOn: [1] },
      { osModelId: c.junta.id, columnIndex: 0, dependsOn: [0] },
    ])
    expect([cycle.statusCode, json(cycle).message]).toEqual([422, 'Dependência circular entre OS'])
    const notProcess = await template(c, [{ osModelId: c.recalculo.id, columnIndex: 0, dependsOn: [] }])
    expect([notProcess.statusCode, json(notProcess).message]).toEqual([422, 'Essa OS não é usada em processos'])
  })

  it('a process with an OS that asks for the competence needs it at opening', async () => {
    const c = await setup()
    await prisma.oSModel.update({ where: { id: c.inscricao.id }, data: { requiresCompetence: true } })
    const t = json(await template(c, [{ osModelId: c.inscricao.id, columnIndex: 0, dependsOn: [] }]))
    const missing = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })
    expect([missing.statusCode, json(missing).message]).toEqual([422, 'Informe a competência'])
    const ok = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id, competence: '2026-10' } })
    expect(ok.statusCode).toBe(201)
    const task = await prisma.task.findFirstOrThrow({ where: { column: { boardId: json(ok).id } } })
    expect([task.title, task.competence?.toISOString().slice(0, 7)]).toEqual(['Inscrição municipal — 10/2026', '2026-10'])
  })

  it('adds an OS to an existing process, waiting for another one', async () => {
    const c = await setup()
    const t = json(await template(c, [{ osModelId: c.inscricao.id, columnIndex: 0, dependsOn: [] }]))
    const board = json(await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } }))
    const first = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } } })
    const col = await prisma.column.findFirstOrThrow({ where: { boardId: board.id, position: 1 } })
    const res = await app.inject({ method: 'POST', url: `/boards/${board.id}/os`, headers: { authorization: c.admin }, payload: { osModelId: c.junta.id, columnId: col.id, dependsOnTaskIds: [first.id] } })
    expect(res.statusCode).toBe(201)
    expect(json(res).releasedAt).toBeNull()
  })
})

describe('fila do robô com OS', () => {
  it('the suggestion says it is an OS and names the model', async () => {
    const c = await setup()
    const os = json(await openOS(c, { osModelId: c.recalculo.id, clientId: c.client.id, competence: '2025-03' }))
    const guia = await prisma.taskDeliverable.findFirstOrThrow({ where: { taskId: os.id } })
    await prisma.receivedDocument.create({ data: { organizationId: c.org.id, fileHash: `q-${c.org.id}`, storageKey: `k/${c.org.id}/1-g.pdf`, status: 'PENDING', taskId: os.id, deliverableId: guia.id, extractedFields: {} } })
    const { listarFilaDeRevisao } = await import('@/modules/document-reader/document-reader.service')
    const [item] = await listarFilaDeRevisao(c.org.id)
    expect(item.suggestion).toMatchObject({ osModelName: 'Recálculo DAS', processTitle: null })
  })
})

describe('abrir processo é tudo ou nada', () => {
  it('an OS whose department does not serve the client refuses the process and leaves no board behind', async () => {
    const c = await setup()
    const other = await prisma.department.create({ data: { organizationId: c.org.id, name: 'Societário' } })
    const foreign = await prisma.oSModel.create({ data: { organizationId: c.org.id, departmentId: other.id, name: 'Alteração contratual', usableInProcess: true } })
    const t = JSON.parse((await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: c.admin }, payload: { name: 'P', columns: [{ title: 'A', statusEffect: 'OPEN', documents: [] }], items: [{ osModelId: c.inscricao.id, columnIndex: 0, dependsOn: [] }, { osModelId: foreign.id, columnIndex: 0, dependsOn: [] }] } })).body)
    const res = await app.inject({ method: 'POST', url: '/boards', headers: { authorization: c.admin }, payload: { title: 'P', clientId: c.client.id, processTemplateId: t.id } })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(await prisma.board.count({ where: { clientId: c.client.id, type: 'PROCESS' } })).toBe(0)
  })
})
