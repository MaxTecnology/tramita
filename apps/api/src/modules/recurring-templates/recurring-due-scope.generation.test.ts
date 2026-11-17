import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as queue from '@/lib/queue'
import { createTestPlan, createTestOrg, createTestDepartment, createTestClient, createTestRecurringAssignment } from '@/test/helpers'
import { createTemplate, generateTaskForAssignment } from './recurring-templates.service'
import type { DueRuleInput } from './recurring-templates.schema'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
})

const DEC_2026 = new Date(Date.UTC(2026, 11, 1))
const NOV_2026 = new Date(Date.UTC(2026, 10, 1))

async function setup(location: { dueScope?: 'FEDERAL' | 'STATE' | 'CITY'; onlyListedLocations?: boolean; dueRules?: DueRuleInput[]; dueDayOfPeriod?: number } = {}) {
  const org = await createTestOrg((await createTestPlan()).id)
  const dept = await createTestDepartment(org.id)
  const template = await createTemplate(org.id, {
    departmentId: dept.id, title: 'ICMS', periodicity: 'MONTHLY', priority: 'MEDIUM',
    competenceMonthOffset: 1, dueDayOfPeriod: location.dueDayOfPeriod ?? 20, dueMonthAnchor: 1, dueBusinessDayRoll: 'NONE',
    targetOffsetDays: 0, targetBusinessDayRoll: 'NONE', generationMonthOffset: 1, generationDayOfPeriod: 1,
    autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false, visibleToClient: true, isActive: true,
    documentRequests: [], documentDeliveries: [],
    dueScope: location.dueScope, onlyListedLocations: location.onlyListedLocations, dueRules: location.dueRules,
  })
  return { org, template }
}
type Ctx = Awaited<ReturnType<typeof setup>>

async function generateFor(c: Ctx, client: { estado?: string | null; ibgeCityCode?: number | null }, dueMonth = DEC_2026) {
  const created = await createTestClient(c.org.id, { name: 'Padaria', ...client })
  const assignment = await createTestRecurringAssignment(c.template.id, c.org.id, { clientId: created.id })
  const outcome = await generateTaskForAssignment(c.template.id, assignment.id, dueMonth)
  return { outcome, client: created, assignment }
}

async function dueDateOf(outcome: Awaited<ReturnType<typeof generateTaskForAssignment>>) {
  if (outcome.status !== 'SUCCESS') throw new Error(JSON.stringify(outcome))
  const task = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
  return task.dueDate?.toISOString().slice(0, 10)
}

const SE_15: DueRuleInput = { uf: 'SE', dueDayOfPeriod: 15, dueBusinessDayRoll: 'NONE' }

describe('geração com vencimento por localidade', () => {
  it('state rule: a client from SE gets day 15, a client from AL the default day 20', async () => {
    const c = await setup({ dueScope: 'STATE', dueRules: [SE_15] })
    expect(await dueDateOf((await generateFor(c, { estado: 'SE', ibgeCityCode: 2800308 })).outcome)).toBe('2026-12-15')
    expect(await dueDateOf((await generateFor(c, { estado: 'AL', ibgeCityCode: 2704302 })).outcome)).toBe('2026-12-20')
  })

  it('city rule: Aracaju gets its day, another city of the same state the default', async () => {
    const c = await setup({ dueScope: 'CITY', dueRules: [{ ibgeCityCode: 2800308, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE' }] })
    expect(await dueDateOf((await generateFor(c, { estado: 'SE', ibgeCityCode: 2800308 })).outcome)).toBe('2026-12-10')
    expect(await dueDateOf((await generateFor(c, { estado: 'SE', ibgeCityCode: 2804805 })).outcome)).toBe('2026-12-20')
  })

  it('a rule on day 31 in a 30-day month lands where the default day 31 would', async () => {
    const federal = await setup({ dueDayOfPeriod: 31 })
    const expected = await dueDateOf((await generateFor(federal, {}, NOV_2026)).outcome)
    const byState = await setup({ dueScope: 'STATE', dueRules: [{ uf: 'SE', dueDayOfPeriod: 31, dueBusinessDayRoll: 'NONE' }] })
    expect(await dueDateOf((await generateFor(byState, { estado: 'SE', ibgeCityCode: 2800308 }, NOV_2026)).outcome)).toBe(expected)
  })

  it('the rule roll uses the office calendar: forward past an office holiday', async () => {
    const c = await setup({ dueScope: 'STATE', dueRules: [{ uf: 'SE', dueDayOfPeriod: 15, dueBusinessDayRoll: 'FORWARD' }] })
    await prisma.holiday.create({ data: { organizationId: c.org.id, date: new Date(Date.UTC(2026, 11, 15)), name: 'Feriado do escritório' } })
    expect(await dueDateOf((await generateFor(c, { estado: 'SE', ibgeCityCode: 2800308 })).outcome)).toBe('2026-12-16')
  })

  it('an old client without city fails with the reason; once fixed, the next run creates the task', async () => {
    const c = await setup({ dueScope: 'CITY', dueRules: [{ ibgeCityCode: 2800308, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE' }] })
    const { outcome, client, assignment } = await generateFor(c, { estado: 'SE', ibgeCityCode: null })
    expect(outcome).toEqual({ status: 'FAILED', errorMessage: 'Cliente Padaria sem cidade cadastrada' })
    expect(await prisma.task.count({ where: { recurringTemplateId: c.template.id } })).toBe(0)

    await prisma.client.update({ where: { id: client.id }, data: { ibgeCityCode: 2800308, cidade: 'Aracaju' } })
    const retry = await generateTaskForAssignment(c.template.id, assignment.id, DEC_2026)
    expect(await dueDateOf(retry)).toBe('2026-12-10')
    expect(await prisma.recurringGenerationLog.findMany({ where: { templateId: c.template.id }, select: { status: true } })).toEqual([{ status: 'SUCCESS' }])
  })

  it('only listed places: a client elsewhere gets no task, with the reason', async () => {
    const c = await setup({ dueScope: 'STATE', onlyListedLocations: true, dueRules: [SE_15] })
    const { outcome } = await generateFor(c, { estado: 'AL', ibgeCityCode: 2704302 })
    expect(outcome).toEqual({ status: 'FAILED', errorMessage: 'Cliente Padaria fora dos locais desta recorrência' })
  })

  it('federal: same date as before, wherever the client is', async () => {
    const c = await setup()
    expect(await dueDateOf((await generateFor(c, { estado: null, ibgeCityCode: null })).outcome)).toBe('2026-12-20')
  })
})
