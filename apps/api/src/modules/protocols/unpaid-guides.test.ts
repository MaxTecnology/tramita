import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { insertProtocol, expireOverdueProtocols } from './protocols.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  serveClientDepartment, createTestBoard, createTestColumn, createTestTask, createTestClientUser, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// now fixed at 2026-11-15 12:00 BRT
const NOW = new Date('2026-11-15T15:00:00.000Z')
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const client = await createTestClient(org.id, { name: 'ACME LTDA' })
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, admin.id)
  await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: true } })
  const guide = (title: string, amount: string, due: string, extra: { requiresPayment?: boolean } = {}) =>
    insertProtocol({
      organizationId: org.id, clientId: client.id, taskId: task.id, title, createdById: admin.id,
      content: 'x', dueDate: day(due), competence: day('2026-10-01'),
      requiresPayment: extra.requiresPayment ?? true, amount: (extra.requiresPayment ?? true) ? amount : null,
    })
  const auth = await getAuthHeader(admin.email, 'Test@1234')
  return { org, admin, client, task, guide, auth }
}

describe('guias não pagas no escritório', () => {
  it('lists only unpaid, non-cancelled payment protocols ordered by due date with overdue first', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const { guide, auth } = await setup()
      await guide('FGTS', '100.00', '2026-11-20')
      await guide('DAS', '1234.56', '2026-11-10')
      await guide('Extrato', '0', '2026-11-01', { requiresPayment: false })
      const cancelled = await guide('INSS', '50.00', '2026-11-05')
      await prisma.protocol.update({ where: { id: cancelled.id }, data: { cancelledAt: new Date() } })

      const res = await app.inject({ method: 'GET', url: '/protocols/unpaid', headers: { authorization: auth } })

      expect(res.statusCode).toBe(200)
      const items = JSON.parse(res.body) as { title: string; amount: string; overdue: boolean; clientName: string }[]
      expect(items.map((i) => [i.title, i.amount, i.overdue])).toEqual([['DAS', '1234.56', true], ['FGTS', '100', false]])
      expect(items[0].clientName).toBe('ACME LTDA')
    } finally {
      vi.useRealTimers()
    }
  })

  it('summary totals unpaid and overdue amounts as decimal strings', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const { guide, auth } = await setup()
      await guide('DAS', '1234.56', '2026-11-10')
      await guide('FGTS', '100.00', '2026-11-20')

      const res = await app.inject({ method: 'GET', url: '/protocols/unpaid/summary', headers: { authorization: auth } })

      expect(JSON.parse(res.body)).toEqual({ unpaidCount: 2, unpaidTotal: '1334.56', overdueCount: 1, overdueTotal: '1234.56' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('paid guide leaves the list and the summary; situation=paid lists it with who paid', async () => {
    const { org, client, guide, auth } = await setup()
    const das = await guide('DAS', '1234.56', '2026-11-10')
    const { clientUser: payer } = await createTestClientUser(org.id, { name: 'Financeiro ACME' })
    void client
    await prisma.protocol.update({ where: { id: das.id }, data: { paidAt: new Date(), paidAmount: '1234.56', paidByClientUserId: payer.id } })

    const unpaid = await app.inject({ method: 'GET', url: '/protocols/unpaid', headers: { authorization: auth } })
    const summary = await app.inject({ method: 'GET', url: '/protocols/unpaid/summary', headers: { authorization: auth } })
    const paid = await app.inject({ method: 'GET', url: '/protocols/unpaid?situation=paid', headers: { authorization: auth } })

    expect(JSON.parse(unpaid.body)).toHaveLength(0)
    expect(JSON.parse(summary.body).unpaidCount).toBe(0)
    const paidItems = JSON.parse(paid.body) as { title: string; paidByName: string; paidAmount: string }[]
    expect(paidItems.map((p) => [p.title, p.paidByName, p.paidAmount])).toEqual([['DAS', 'Financeiro ACME', '1234.56']])
  })

  it('ORG_MEMBER only sees guides of processes visible to them', async () => {
    const { org, client, guide } = await setup()
    await guide('DAS', '10.00', '2026-11-10')
    const outsider = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const responsible = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const dept = await createTestDepartment(org.id)
    await serveClientDepartment(client.id, dept.id, responsible.id)

    const a = await app.inject({ method: 'GET', url: '/protocols/unpaid', headers: { authorization: await getAuthHeader(outsider.email, 'Test@1234') } })
    const b = await app.inject({ method: 'GET', url: '/protocols/unpaid', headers: { authorization: await getAuthHeader(responsible.email, 'Test@1234') } })

    expect(JSON.parse(a.body)).toHaveLength(0)
    expect(JSON.parse(b.body)).toHaveLength(1)
  })

  it('expiry skips paid and cancelled protocols', async () => {
    const { org, guide } = await setup()
    const paid = await guide('DAS', '10.00', '2026-11-01')
    const cancelled = await guide('FGTS', '10.00', '2026-11-01')
    const open = await guide('INSS', '10.00', '2026-11-01')
    await prisma.protocol.update({ where: { id: paid.id }, data: { paidAt: new Date(), paidAmount: '10' } })
    await prisma.protocol.update({ where: { id: cancelled.id }, data: { cancelledAt: new Date() } })

    await expireOverdueProtocols(org.id, NOW)

    const statuses = Object.fromEntries((await prisma.protocol.findMany({ where: { id: { in: [paid.id, cancelled.id, open.id] } } })).map((p) => [p.title, p.status]))
    expect(statuses).toEqual({ DAS: 'SENT', FGTS: 'SENT', INSS: 'EXPIRED' })
  })
})

describe('resumo de protocolos (revisão final)', () => {
  it('GET /protocols/summary ignores cancelled protocols', async () => {
    const { guide, auth } = await setup()
    await guide('DAS', '10.00', '2026-11-20')
    const cancelled = await guide('INSS', '10.00', '2026-11-20')
    await prisma.protocol.update({ where: { id: cancelled.id }, data: { cancelledAt: new Date() } })

    const res = await app.inject({ method: 'GET', url: '/protocols/summary', headers: { authorization: auth } })

    expect(JSON.parse(res.body).SENT).toBe(1)
  })
})
