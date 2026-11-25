import { expect, it } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment, serveClientDepartment, getAuthHeader } from '@/test/helpers'
import { createTemplate } from './recurring-templates.service'

// A client served only by Fiscal is linked while the template moves to Pessoal: one of the two must lose
it('linking a client and changing the template department at the same time never leave a client the department does not serve', async () => {
  for (let round = 0; round < 5; round++) {
    const org = await createTestOrg((await createTestPlan()).id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
    const pessoal = await createTestDepartment(org.id, { name: 'Pessoal' })
    const client = await createTestClient(org.id)
    await serveClientDepartment(client.id, fiscal.id, admin.id)
    const t = await createTemplate(org.id, {
      departmentId: fiscal.id, title: 'ICMS', periodicity: 'MONTHLY', priority: 'MEDIUM', competenceMonthOffset: 1, dueDayOfPeriod: 20,
      dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE', targetOffsetDays: 0, targetBusinessDayRoll: 'NONE', generationMonthOffset: 1,
      generationDayOfPeriod: 1, autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await Promise.all([
      app.inject({ method: 'POST', url: `/recurring-templates/${t.id}/assignments`, headers: { authorization: auth }, payload: { clientId: client.id } }),
      app.inject({ method: 'PATCH', url: `/recurring-templates/${t.id}`, headers: { authorization: auth }, payload: { departmentId: pessoal.id } }),
    ])
    const final = await prisma.recurringTaskTemplate.findUniqueOrThrow({ where: { id: t.id }, select: { departmentId: true } })
    const linked = await prisma.recurringTaskAssignment.count({ where: { templateId: t.id, isActive: true } })
    // Either the link exists and the template stayed in Fiscal, or the template moved and nothing is linked
    expect(linked === 1 ? final.departmentId : pessoal.id).toBe(linked === 1 ? fiscal.id : final.departmentId)
  }
})
