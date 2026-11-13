import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  createTestTask, getAuthHeader,
} from '@/test/helpers'

// A notification link (/app/tasks?task=<id>) opens a task that may be outside the screen filters
describe('GET /tasks?taskId=', () => {
  it('returns that task even outside the period/status filters, and nothing outside the scope', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const folha = await createTestDepartment(org.id, { name: 'Folha' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const carla = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
    const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [folha.id] })
    const acme = await createTestClient(org.id)
    await serveClientDepartment(acme.id, fiscal.id, carla.id)
    await serveClientDepartment(acme.id, folha.id, dani.id)
    const board = await prisma.board.create({ data: { title: 'Rec', organizationId: org.id, clientId: acme.id, type: 'RECURRING_SYSTEM', columns: { create: [{ title: 'R', position: 0 }] } }, include: { columns: true } })
    const old = await createTestTask(board.columns[0].id, admin.id, { departmentId: fiscal.id, title: 'Apuração de março' })
    await prisma.task.update({ where: { id: old.id }, data: { status: 'DONE', assigneeId: carla.id, targetDate: new Date('2025-03-10') } })

    const carlaRes = await app.inject({ method: 'GET', url: `/tasks?taskId=${old.id}&status=OPEN&dateFrom=2026-11-01T00:00:00.000Z`, headers: { authorization: await getAuthHeader(carla.email, 'Test@1234') } })
    expect(JSON.parse(carlaRes.body).items.map((t: { id: string }) => t.id)).toEqual([old.id])

    const daniRes = await app.inject({ method: 'GET', url: `/tasks?taskId=${old.id}`, headers: { authorization: await getAuthHeader(dani.email, 'Test@1234') } })
    expect(JSON.parse(daniRes.body).items).toEqual([])
  })
})
