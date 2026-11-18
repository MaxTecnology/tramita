import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient, serveClientDepartment,
  addUserToDepartment, createTestRecurringAssignment, getAuthHeader,
} from '@/test/helpers'
import { createTemplate } from '@/modules/recurring-templates/recurring-templates.service'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  return { org, admin, auth: await getAuthHeader(admin.email, 'Test@1234') }
}

describe('contagens nas listas de Configurações', () => {
  it('each department says how many people work in it and how many active clients it serves', async () => {
    const c = await setup()
    const fiscal = await createTestDepartment(c.org.id, { name: 'Fiscal' })
    const empty = await createTestDepartment(c.org.id, { name: 'Pessoal' })
    for (let i = 0; i < 2; i++) await addUserToDepartment((await createTestUser(c.org.id, { role: 'ORG_MEMBER' })).id, fiscal.id)
    const inactiveMember = await createTestUser(c.org.id, { role: 'ORG_MEMBER' })
    await addUserToDepartment(inactiveMember.id, fiscal.id)
    await prisma.user.update({ where: { id: inactiveMember.id }, data: { isActive: false } })
    await serveClientDepartment((await createTestClient(c.org.id)).id, fiscal.id, c.admin.id)
    await serveClientDepartment((await createTestClient(c.org.id, { isActive: false })).id, fiscal.id, c.admin.id)

    const list = (await app.inject({ method: 'GET', url: '/departments', headers: { authorization: c.auth } })).json() as { id: string; peopleCount: number; clientsCount: number }[]
    expect(list.find((d) => d.id === fiscal.id)).toMatchObject({ peopleCount: 2, clientsCount: 1 })
    expect(list.find((d) => d.id === empty.id)).toMatchObject({ peopleCount: 0, clientsCount: 0 })
  })

  it('each recurring template says how many clients are linked (active links)', async () => {
    const c = await setup()
    const dept = await createTestDepartment(c.org.id)
    const template = await createTemplate(c.org.id, {
      departmentId: dept.id, title: 'ICMS', periodicity: 'MONTHLY', priority: 'MEDIUM', competenceMonthOffset: 1, dueDayOfPeriod: 20,
      dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE', targetOffsetDays: 0, targetBusinessDayRoll: 'NONE', generationMonthOffset: 1,
      generationDayOfPeriod: 1, autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createTestRecurringAssignment(template.id, c.org.id, { clientId: (await createTestClient(c.org.id)).id })
    const paused = await createTestRecurringAssignment(template.id, c.org.id, { clientId: (await createTestClient(c.org.id)).id })
    await prisma.recurringTaskAssignment.update({ where: { id: paused.id }, data: { isActive: false } })

    const list = (await app.inject({ method: 'GET', url: '/recurring-templates', headers: { authorization: c.auth } })).json() as { id: string; assignmentsCount: number }[]
    expect(list.find((t) => t.id === template.id)?.assignmentsCount).toBe(1)
  })
})
