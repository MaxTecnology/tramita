import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { loadHolidaySet } from './holidays.service'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  return { org, admin: await getAuthHeader(admin.email, 'Test@1234'), member: await getAuthHeader(member.email, 'Test@1234') }
}

describe('feriados do escritório', () => {
  it('lists the national holidays of the year and the office ones', async () => {
    const c = await setup()
    const created = await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2026-01-20', name: 'São Sebastião' } })
    expect(created.statusCode).toBe(201)
    const res = await app.inject({ method: 'GET', url: '/holidays?year=2026', headers: { authorization: c.member } })
    const body = JSON.parse(res.body)
    expect(body.national).toContainEqual({ date: '2026-04-03', name: 'Sexta-feira Santa' })
    expect(body.custom).toHaveLength(1)
    expect(body.custom[0]).toMatchObject({ date: '2026-01-20', name: 'São Sebastião' })
  })

  it('a holiday already registered on the date is refused', async () => {
    const c = await setup()
    await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2026-02-16', name: 'Carnaval' } })
    const again = await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2026-02-16', name: 'Carnaval' } })
    expect([again.statusCode, JSON.parse(again.body).message]).toEqual([409, 'Já existe feriado nesta data'])
  })

  it('only the admin registers or removes; another office does not see it', async () => {
    const c = await setup()
    const byMember = await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.member }, payload: { date: '2026-02-17', name: 'Carnaval' } })
    expect(byMember.statusCode).toBe(403)
    const created = JSON.parse((await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2026-02-17', name: 'Carnaval' } })).body)
    const other = await setup()
    expect((await app.inject({ method: 'DELETE', url: `/holidays/${created.id}`, headers: { authorization: other.admin } })).statusCode).toBe(404)
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/holidays?year=2026', headers: { authorization: other.admin } })).body).custom).toHaveLength(0)
    expect((await app.inject({ method: 'DELETE', url: `/holidays/${created.id}`, headers: { authorization: c.admin } })).statusCode).toBe(200)
  })

  it('loadHolidaySet joins the national and the office holidays of the years asked', async () => {
    const c = await setup()
    await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2027-01-20', name: 'São Sebastião' } })
    const set = await loadHolidaySet(c.org.id, [2026, 2027])
    expect(set.has('2026-11-20')).toBe(true)
    expect(set.has('2027-01-20')).toBe(true)
    expect(set.has('2027-01-21')).toBe(false)
  })
})

describe('GET /holidays/days', () => {
  it('returns every holiday day (national + office) of the year range, for date previews', async () => {
    const c = await setup()
    await app.inject({ method: 'POST', url: '/holidays', headers: { authorization: c.admin }, payload: { date: '2027-01-20', name: 'São Sebastião' } })
    const res = await app.inject({ method: 'GET', url: '/holidays/days?from=2026&to=2027', headers: { authorization: c.member } })
    const days: string[] = JSON.parse(res.body)
    expect(days).toEqual(expect.arrayContaining(['2026-11-20', '2027-04-21', '2027-01-20']))
    expect((await app.inject({ method: 'GET', url: '/holidays/days?from=2026&to=2040', headers: { authorization: c.member } })).statusCode).toBe(400)
  })
})
