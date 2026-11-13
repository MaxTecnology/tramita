import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn,
  createTestTask, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const acme = await createTestClient(org.id, { name: 'ACME Comércio', codigo: '0042' })
  const beta = await createTestClient(org.id, { name: 'Beta Serviços', codigo: '0077' })
  const colA = await createTestColumn((await createTestBoard(org.id, acme.id)).id)
  const colB = await createTestColumn((await createTestBoard(org.id, beta.id)).id)
  const mk = async (col: string, title: string, dates: { targetDate?: Date; dueDate?: Date } = {}) => {
    const t = await createTestTask(col, admin.id, { title })
    return prisma.task.update({ where: { id: t.id }, data: dates })
  }
  await mk(colA.id, 'Meta em novembro', { targetDate: new Date('2026-11-10') })
  await mk(colA.id, 'Vence em novembro', { dueDate: new Date('2026-11-20') })
  await mk(colA.id, 'Meta em outubro', { targetDate: new Date('2026-10-10') })
  await mk(colA.id, 'Sem data')
  await mk(colB.id, 'Folha mensal')
  return { auth: await getAuthHeader(admin.email, 'Test@1234') }
}

const titles = async (auth: string, qs: string) =>
  (JSON.parse((await app.inject({ method: 'GET', url: `/tasks?${qs}`, headers: { authorization: auth } })).body).items as { title: string }[])
    .map((t) => t.title).sort()

describe('filtros da lista de tarefas', () => {
  it('period: target or due date in the month, plus tasks without any date', async () => {
    const c = await setup()
    const qs = `dateField=period&dateFrom=${encodeURIComponent('2026-11-01T00:00:00.000Z')}&dateTo=${encodeURIComponent('2026-11-30T23:59:59.000Z')}`
    expect(await titles(c.auth, qs)).toEqual(['Folha mensal', 'Meta em novembro', 'Sem data', 'Vence em novembro'])
  })

  it('search also matches the client name and code', async () => {
    const c = await setup()
    expect(await titles(c.auth, 'q=beta')).toEqual(['Folha mensal'])
    expect(await titles(c.auth, 'q=0042')).toEqual(['Meta em novembro', 'Meta em outubro', 'Sem data', 'Vence em novembro'])
    expect(await titles(c.auth, 'q=outubro')).toEqual(['Meta em outubro'])
  })
})
