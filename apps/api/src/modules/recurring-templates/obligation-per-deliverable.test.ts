import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTemplate, updateTemplate, generateManually } from './recurring-templates.service'
import { createTestPlan, createTestOrg, createTestClient, createTestDepartment, createTestRecurringAssignment } from '@/test/helpers'

afterEach(() => vi.restoreAllMocks())

const base = {
  title: 'Folha de pagamento', periodicity: 'MONTHLY' as const, priority: 'MEDIUM' as const,
  competenceMonthOffset: 0, dueDayOfPeriod: 20, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE' as const,
  targetOffsetDays: 0, targetBusinessDayRoll: 'NONE' as const,
  generationMonthOffset: 1, generationDayOfPeriod: 5,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [],
}

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const dept = await createTestDepartment(org.id)
  const das = await prisma.obligationType.create({ data: { code: `DAS-${org.id}`, name: 'DAS', organizationId: null } })
  const fgts = await prisma.obligationType.create({ data: { code: `FGTS-${org.id}`, name: 'FGTS', organizationId: org.id } })
  return { org, dept, das, fgts }
}

describe('robô por documento a entregar', () => {
  it('each delivery of the template keeps its own robot obligation; the generated task copies it', async () => {
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    const { org, dept, das, fgts } = await setup()
    const template = await createTemplate(org.id, {
      ...base, departmentId: dept.id,
      documentDeliveries: [
        { name: 'Holerites', requiresPayment: false },
        { name: 'Guia FGTS', requiresPayment: true, obligationTypeId: fgts.id },
        { name: 'Guia DAS', requiresPayment: true, obligationTypeId: das.id },
      ],
    })
    expect(template.documentDeliveries.map((d) => [d.name, d.obligationTypeId])).toEqual([
      ['Holerites', null], ['Guia FGTS', fgts.id], ['Guia DAS', das.id],
    ])

    const client = await createTestClient(org.id)
    const assignment = await createTestRecurringAssignment(template.id, org.id, { clientId: client.id })
    const { taskId } = await generateManually(template.id, assignment.id, org.id, new Date().toISOString())
    const deliverables = await prisma.taskDeliverable.findMany({ where: { taskId: taskId! }, orderBy: { position: 'asc' } })
    expect(deliverables.map((d) => [d.name, d.obligationTypeId])).toEqual([['Holerites', null], ['Guia FGTS', fgts.id], ['Guia DAS', das.id]])
  })

  it('editing replaces the deliveries with their obligations', async () => {
    const { org, dept, das } = await setup()
    const template = await createTemplate(org.id, { ...base, departmentId: dept.id, documentDeliveries: [{ name: 'Guia', requiresPayment: true }] })
    const updated = await updateTemplate(template.id, org.id, { documentDeliveries: [{ name: 'Guia DAS', requiresPayment: true, obligationTypeId: das.id }] })
    expect(updated.documentDeliveries.map((d) => [d.name, d.obligationTypeId])).toEqual([['Guia DAS', das.id]])
  })

  it('an obligation private to another office is refused (404)', async () => {
    const { org, dept } = await setup()
    const other = await setup()
    await expect(createTemplate(org.id, {
      ...base, departmentId: dept.id, documentDeliveries: [{ name: 'Guia FGTS', requiresPayment: true, obligationTypeId: other.fgts.id }],
    })).rejects.toMatchObject({ statusCode: 404 })
  })
})
