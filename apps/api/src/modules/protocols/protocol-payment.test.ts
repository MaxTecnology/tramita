import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import { multipartBody } from '@/test/multipart'
import { insertProtocol } from './protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestClientUser, grantClientAccess, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed')
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function clientLogin(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return `Bearer ${JSON.parse(res.body).accessToken}`
}

async function setup(opts: { requiresPayment?: boolean } = {}) {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, admin.id, { departmentId: fiscal.id })
  await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: true } })
  const requiresPayment = opts.requiresPayment ?? true
  const protocol = await insertProtocol({
    organizationId: org.id, clientId: client.id, taskId: task.id, title: 'Guia DAS', content: 'x',
    createdById: admin.id, requiresPayment, amount: requiresPayment ? '1234.56' : null, dueDate: new Date('2026-11-20'),
  })
  const { clientUser: financeiro, password } = await createTestClientUser(org.id, { name: 'Financeiro ACME' })
  await grantClientAccess(financeiro.id, client.id, fiscal.id)
  const { clientUser: rh, password: rhPassword } = await createTestClientUser(org.id, { name: 'RH ACME' })
  await grantClientAccess(rh.id, client.id, folha.id)
  return {
    org, client, task, protocol, financeiro,
    auth: await clientLogin(financeiro.email, password),
    rhAuth: await clientLogin(rh.email, rhPassword),
  }
}

describe('marcar guia como paga (portal)', () => {
  it('client marks a guide as paid with proof; history shows who and when', async () => {
    const { protocol, auth, financeiro } = await setup()
    const mp = multipartBody({ amount: '1234.56' }, { filename: 'comprovante.pdf' })

    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(200)
    const after = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id }, include: { events: true, paymentProof: true } })
    expect(after.paidAt).not.toBeNull()
    expect(after.paidAmount?.toString()).toBe('1234.56')
    expect(after.paidByClientUserId).toBe(financeiro.id)
    expect(after.paymentProof?.filename).toBe('comprovante.pdf')
    expect(after.events.map((e) => e.type)).toEqual(expect.arrayContaining(['PAID', 'VIEWED']))

    const detail = await app.inject({ method: 'GET', url: `/portal/protocols/${protocol.id}`, headers: { authorization: auth } })
    const paidEvent = (JSON.parse(detail.body).events as { type: string; actorName: string }[]).find((e) => e.type === 'PAID')
    expect(paidEvent?.actorName).toBe('Financeiro ACME')
  })

  it('proof with a forbidden type is refused with 422 and the guide stays unpaid', async () => {
    const { protocol, auth } = await setup()
    const mp = multipartBody({ amount: '1234.56' }, { filename: 'comprovante.exe' })

    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(422)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).paidAt).toBeNull()
  })

  it('proof over 20MB answers 413 in Portuguese', async () => {
    const { protocol, auth } = await setup()
    const mp = multipartBody({ amount: '1234.56' }, { filename: 'comprovante.pdf', content: 'x'.repeat(20 * 1024 * 1024 + 10) })

    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body).message).toBe('Arquivo excede o limite de 20MB')
  })

  it('accepts a JSON body without proof', async () => {
    const { protocol, auth } = await setup()
    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth }, payload: { amount: '1200.00' } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).paidAmount?.toString()).toBe('1200')
  })

  it('double mark paid yields a single PAID event and 409 on the second', async () => {
    const { protocol, auth } = await setup()
    const pay = () => app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth }, payload: { amount: '1234.56' } })

    const [a, b] = await Promise.all([pay(), pay()])

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(await prisma.protocolEvent.count({ where: { protocolId: protocol.id, type: 'PAID' } })).toBe(1)
  })

  it('user with access only to Folha gets 404 paying a Fiscal guide and nothing changes', async () => {
    const { protocol, rhAuth } = await setup()

    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: rhAuth }, payload: { amount: '1234.56' } })
    const undo = await app.inject({ method: 'DELETE', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: rhAuth } })

    expect(res.statusCode).toBe(404)
    expect(undo.statusCode).toBe(404)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).paidAt).toBeNull()
  })

  it('non-payment document refuses pay with 422', async () => {
    const { protocol, auth } = await setup({ requiresPayment: false })
    const res = await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth }, payload: { amount: '10.00' } })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).message).toBe('Esse documento não é uma guia de pagamento')
  })

  it('unmark restores unpaid and logs UNPAID', async () => {
    const { protocol, auth } = await setup()
    await app.inject({ method: 'POST', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth }, payload: { amount: '1234.56' } })

    const res = await app.inject({ method: 'DELETE', url: `/portal/protocols/${protocol.id}/pay`, headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    const after = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(after.paidAt).toBeNull()
    expect(after.paidAmount).toBeNull()
    expect(await prisma.protocolEvent.count({ where: { protocolId: protocol.id, type: 'UNPAID' } })).toBe(1)
  })

  it('protocol stays listed after its task is hidden from client; cancelled protocol disappears', async () => {
    const { client, task, protocol, auth } = await setup()
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    const list = await app.inject({ method: 'GET', url: `/portal/protocols?clientId=${client.id}`, headers: { authorization: auth } })
    const items = JSON.parse(list.body) as { id: string; amount: string; requiresPayment: boolean; departmentName: string }[]
    expect(items.map((i) => [i.id, i.amount, i.requiresPayment, i.departmentName])).toEqual([[protocol.id, '1234.56', true, 'Fiscal']])

    await prisma.protocol.update({ where: { id: protocol.id }, data: { cancelledAt: new Date() } })
    const after = await app.inject({ method: 'GET', url: `/portal/protocols?clientId=${client.id}`, headers: { authorization: auth } })
    const detail = await app.inject({ method: 'GET', url: `/portal/protocols/${protocol.id}`, headers: { authorization: auth } })
    expect(JSON.parse(after.body)).toHaveLength(0)
    expect(detail.statusCode).toBe(404)
  })

  it('filters by payment status', async () => {
    const { client, protocol, auth } = await setup()
    await prisma.protocol.update({ where: { id: protocol.id }, data: { paidAt: new Date(), paidAmount: '1' } })

    const unpaid = await app.inject({ method: 'GET', url: `/portal/protocols?clientId=${client.id}&paymentStatus=unpaid`, headers: { authorization: auth } })
    const paid = await app.inject({ method: 'GET', url: `/portal/protocols?clientId=${client.id}&paymentStatus=paid`, headers: { authorization: auth } })

    expect(JSON.parse(unpaid.body)).toHaveLength(0)
    expect(JSON.parse(paid.body)).toHaveLength(1)
  })
})
