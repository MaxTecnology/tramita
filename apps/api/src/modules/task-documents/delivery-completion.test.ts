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


async function deliver(c: Ctx, name = 'Holerites') {
  const delId = JSON.parse((await post(`/tasks/${c.task.id}/documents/deliveries`, c.daniAuth, { name })).body).id
  const mp = multipartBody({}, { filename: `${name}.pdf` })
  const res = await app.inject({ method: 'POST', url: `/tasks/${c.task.id}/documents/deliveries/${delId}/upload`, headers: { authorization: c.daniAuth, ...mp.headers }, body: mp.body })
  return JSON.parse(res.body)
}

describe('entrega e conclusão da tarefa', () => {
  it('everything resolved after the delivery: the office is asked to complete (READY)', async () => {
    const c = await setup()
    expect((await deliver(c)).completion).toBe('READY')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).status).not.toBe('DONE')
  })

  it('a client document still pending: nothing to ask (PENDING)', async () => {
    const c = await setup()
    await post(`/tasks/${c.task.id}/documents/requests`, c.daniAuth, { name: 'Ponto do mês' })
    expect((await deliver(c)).completion).toBe('PENDING')
  })

  it('a client approval still pending: nothing to ask (PENDING)', async () => {
    const c = await setup()
    await requestApproval(c)
    expect((await deliver(c)).completion).toBe('PENDING')
  })

  it('template with automatic completion: the task is completed by the delivery (AUTO_COMPLETED)', async () => {
    const c = await setup()
    const pessoal = await prisma.department.findFirstOrThrow({ where: { organizationId: c.org.id, name: 'Pessoal' } })
    const tpl = await prisma.recurringTaskTemplate.create({
      data: { organizationId: c.org.id, departmentId: pessoal.id, title: 'Folha', periodicity: 'MONTHLY', dueDayOfPeriod: 5, generationDayOfPeriod: 1, autoCompleteOnAllActivitiesDone: true },
    })
    await prisma.task.update({ where: { id: c.task.id }, data: { recurringTemplateId: tpl.id } })
    expect((await deliver(c)).completion).toBe('AUTO_COMPLETED')
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.task.id } })).status).toBe('DONE')
  })
})
