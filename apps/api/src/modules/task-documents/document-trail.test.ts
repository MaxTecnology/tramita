import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as sse from '@/lib/sse'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

let enqueued: unknown[] = []
beforeEach(() => {
  vi.restoreAllMocks()
  enqueued = []
  vi.spyOn(queue, 'enqueueNotification').mockImplementation(async (job) => { enqueued.push(job) })
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
  vi.spyOn(sse, 'publishOrgEvent').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed.example/file')
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

// ACME served by Pessoal (Dani) and Fiscal (Carla). "Folha" is Dani's recurring task.
async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const pessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' })
  const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carla' })
  const acme = await createTestClient(org.id, { name: 'ACME' })
  await serveClientDepartment(acme.id, pessoal.id, dani.id)
  await serveClientDepartment(acme.id, fiscal.id, carla.id)
  const { clientUser: rh, password } = await createTestClientUser(org.id, { name: 'RH' })
  await grantClientAccess(rh.id, acme.id, pessoal.id)
  const { clientUser: fin, password: finPass } = await createTestClientUser(org.id, { name: 'Financeiro' })
  await grantClientAccess(fin.id, acme.id, fiscal.id)
  const rec = await prisma.board.create({
    data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'A fazer', position: 0 }, { title: 'Feito', position: 1, statusEffect: 'DONE' }] } },
    include: { columns: { orderBy: { position: 'asc' } } },
  })
  const t = await createTestTask(rec.columns[0].id, dani.id, { departmentId: pessoal.id, title: 'Folha de novembro' })
  const task = await prisma.task.update({ where: { id: t.id }, data: { assigneeId: dani.id, visibleToClient: true, competence: new Date('2026-11-01') } })
  return {
    org, acme, dani, carla, rh, fin, task, doneColumn: rec.columns[1],
    daniAuth: await getAuthHeader(dani.email, 'Test@1234'),
    carlaAuth: await getAuthHeader(carla.email, 'Test@1234'),
    rhAuth: await clientLogin(rh.email, password),
    finAuth: await clientLogin(fin.email, finPass),
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function requestApproval(c: Ctx, taskId = c.task.id) {
  const mp = multipartBody({ title: 'Prévia da folha de novembro', message: 'Confere os valores?' }, { filename: 'previa.pdf' })
  return app.inject({ method: 'POST', url: `/tasks/${taskId}/approvals`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
}

const post = (url: string, auth: string, payload?: object) => app.inject({ method: 'POST', url, headers: { authorization: auth }, payload })


const history = async (taskId: string) =>
  (await prisma.taskHistory.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } }))
    .filter((h) => h.action.startsWith('document_') || h.action.startsWith('deliverable_'))
    .map((h) => [h.action, h.actorName, h.fromValue, h.toValue])

async function clientUpload(c: Ctx, reqId: string, filename: string) {
  const mp = multipartBody({}, { filename })
  return app.inject({ method: 'POST', url: `/portal/tasks/${c.task.id}/documents/requests/${reqId}/upload`, headers: { authorization: c.rhAuth, ...mp.headers }, body: mp.body })
}
const review = (c: Ctx, reqId: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/tasks/${c.task.id}/documents/requests/${reqId}`, headers: { authorization: c.daniAuth }, payload })

describe('rastro dos documentos', () => {
  it('records every step in the history, with the person and the file', async () => {
    const c = await setup()
    const added = await post(`/tasks/${c.task.id}/documents/requests`, c.daniAuth, { name: 'Ponto do mês' })
    const reqId = JSON.parse(added.body).id
    await clientUpload(c, reqId, 'ponto-errado.pdf')
    await review(c, reqId, { decision: 'REJECTED', rejectionReason: 'Falta a página 2' })
    await clientUpload(c, reqId, 'ponto-certo.pdf')
    await review(c, reqId, { decision: 'APPROVED' })

    expect(await history(c.task.id)).toEqual([
      ['document_requested', 'Dani', null, 'Ponto do mês'],
      ['document_uploaded', 'RH (ACME)', 'Ponto do mês', 'ponto-errado.pdf'],
      ['document_rejected', 'Dani', 'Ponto do mês — ponto-errado.pdf', 'Falta a página 2'],
      ['document_uploaded', 'RH (ACME)', 'Ponto do mês', 'ponto-certo.pdf'],
      ['document_approved', 'Dani', 'Ponto do mês', 'ponto-certo.pdf'],
    ])
  })

  it('"Nada a enviar", its undo and the office contest are in the history', async () => {
    const c = await setup()
    const reqId = JSON.parse((await post(`/tasks/${c.task.id}/documents/requests`, c.daniAuth, { name: 'Notas' })).body).id
    const na = `/portal/tasks/${c.task.id}/documents/requests/${reqId}/not-applicable`
    await app.inject({ method: 'POST', url: na, headers: { authorization: c.rhAuth } })
    await app.inject({ method: 'DELETE', url: na, headers: { authorization: c.rhAuth } })
    await app.inject({ method: 'POST', url: na, headers: { authorization: c.rhAuth } })
    await review(c, reqId, { decision: 'REJECTED', rejectionReason: 'Houve notas em outubro' })
    expect((await history(c.task.id)).slice(1).map(([a]) => a)).toEqual([
      'document_not_applicable', 'document_not_applicable_undone', 'document_not_applicable', 'document_contested',
    ])
  })

  it('each file keeps how it ended: refused (with reason and who), replaced before review, current', async () => {
    const c = await setup()
    const reqId = JSON.parse((await post(`/tasks/${c.task.id}/documents/requests`, c.daniAuth, { name: 'Ponto do mês' })).body).id
    await clientUpload(c, reqId, 'v1.pdf')
    await review(c, reqId, { decision: 'REJECTED', rejectionReason: 'Ilegível' })
    await clientUpload(c, reqId, 'v2.pdf')
    await clientUpload(c, reqId, 'v3.pdf') // sent again before the office looked at v2

    const list = JSON.parse((await app.inject({ method: 'GET', url: `/tasks/${c.task.id}/attachments`, headers: { authorization: c.daniAuth } })).body)
    const byName = Object.fromEntries(list.map((a: { filename: string }) => [a.filename, a]))
    expect(byName['v1.pdf']).toMatchObject({ uploaderName: 'RH (ACME)', purpose: { kind: 'REQUIREMENT', name: 'Ponto do mês', review: 'REJECTED', rejectionReason: 'Ilegível', reviewedByName: 'Dani', current: false } })
    expect(byName['v2.pdf'].purpose).toMatchObject({ review: 'REPLACED', current: false })
    expect(byName['v3.pdf'].purpose).toMatchObject({ review: 'PENDING_REVIEW', current: true })
  })

  it('a delivery is in the history and tagged in the attachments; approval files are tagged too', async () => {
    const c = await setup()
    const delId = JSON.parse((await post(`/tasks/${c.task.id}/documents/deliveries`, c.daniAuth, { name: 'Holerites' })).body).id
    const mp = multipartBody({}, { filename: 'holerites.pdf' })
    await app.inject({ method: 'POST', url: `/tasks/${c.task.id}/documents/deliveries/${delId}/upload`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
    await requestApproval(c)
    expect((await history(c.task.id)).map(([a, , , to]) => [a, to])).toEqual([
      ['deliverable_requested', 'Holerites'], ['deliverable_delivered', 'holerites.pdf'],
    ])
    const list = JSON.parse((await app.inject({ method: 'GET', url: `/tasks/${c.task.id}/attachments`, headers: { authorization: c.daniAuth } })).body)
    const byName = Object.fromEntries(list.map((a: { filename: string }) => [a.filename, a]))
    expect(byName['holerites.pdf'].purpose).toMatchObject({ kind: 'DELIVERABLE', name: 'Holerites' })
    expect(byName['previa.pdf'].purpose).toMatchObject({ kind: 'APPROVAL_FILE', name: 'Prévia da folha de novembro' })
  })
})
