import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, getAuthHeader } from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const dept = await createTestDepartment(org.id)
  return { org, dept, auth: await getAuthHeader(admin.email, 'Test@1234') }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const base = (c: Ctx, over: Record<string, unknown> = {}) => ({
  departmentId: c.dept.id, title: 'ICMS', periodicity: 'MONTHLY', dueDayOfPeriod: 20, generationDayOfPeriod: 1, ...over,
})

const create = (c: Ctx, over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/recurring-templates', headers: { authorization: c.auth }, payload: base(c, over) })
const patch = (c: Ctx, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/recurring-templates/${id}`, headers: { authorization: c.auth }, payload })
const get = (c: Ctx, id: string) =>
  app.inject({ method: 'GET', url: `/recurring-templates/${id}`, headers: { authorization: c.auth } })

const SE = { uf: 'SE', dueDayOfPeriod: 15, dueBusinessDayRoll: 'FORWARD' }
const AL = { uf: 'AL', dueDayOfPeriod: 10, dueBusinessDayRoll: 'BACKWARD' }
const ARACAJU = { ibgeCityCode: 2800308, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE' }

async function expect400(res: Awaited<ReturnType<typeof create>>, message: string) {
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ message })
}

describe('abrangência do vencimento — validação', () => {
  it('a new template is federal, without rules (same as before)', async () => {
    const c = await setup()
    const res = await create(c)
    expect(res.statusCode).toBe(201)
    expect((await get(c, res.json().id)).json()).toMatchObject({ dueScope: 'FEDERAL', onlyListedLocations: false, dueRules: [] })
  })

  it('federal has no rules and no "only listed places"', async () => {
    const c = await setup()
    await expect400(await create(c, { dueRules: [SE] }), 'Recorrência federal não tem exceções por localidade')
    await expect400(await create(c, { onlyListedLocations: true }), '"Só para os locais listados" exige abrangência estadual ou municipal')
  })

  it('each rule has the shape of the scope', async () => {
    const c = await setup()
    await expect400(await create(c, { dueScope: 'STATE', dueRules: [{ dueDayOfPeriod: 15 }] }), 'Exceção estadual precisa só do estado')
    await expect400(await create(c, { dueScope: 'STATE', dueRules: [{ ...SE, ibgeCityCode: 2800308 }] }), 'Exceção estadual precisa só do estado')
    await expect400(await create(c, { dueScope: 'CITY', dueRules: [SE] }), 'Exceção municipal precisa só da cidade')
    await expect400(await create(c, { dueScope: 'CITY', dueRules: [{ ...ARACAJU, uf: 'SE' }] }), 'Exceção municipal precisa só da cidade')
  })

  it('no repeated place, no unknown city, no invalid state', async () => {
    const c = await setup()
    await expect400(await create(c, { dueScope: 'STATE', dueRules: [SE, { ...SE, dueDayOfPeriod: 5 }] }), 'Estado repetido nas exceções')
    await expect400(await create(c, { dueScope: 'CITY', dueRules: [ARACAJU, ARACAJU] }), 'Cidade repetida nas exceções')
    await expect400(await create(c, { dueScope: 'CITY', dueRules: [{ ...ARACAJU, ibgeCityCode: 9999999 }] }), 'Cidade não encontrada')
    await expect400(await create(c, { dueScope: 'STATE', dueRules: [{ ...SE, uf: 'XX' }] }), 'Estado inválido')
  })

  it('the rule day follows the periodicity like the default day', async () => {
    const c = await setup()
    const res = await create(c, { periodicity: 'WEEKLY', dueDayOfPeriod: 5, dueScope: 'STATE', dueRules: [{ ...SE, dueDayOfPeriod: 8 }] })
    await expect400(res, 'Periodicidade semanal: dia do vencimento deve ser de 1 (segunda) a 7 (domingo)')
  })

  it('saves and replaces the rules; the answer brings the city name', async () => {
    const c = await setup()
    const created = await create(c, { dueScope: 'STATE', onlyListedLocations: true, dueRules: [SE, AL] })
    expect(created.statusCode).toBe(201)
    const id = created.json().id as string
    const rules = (await get(c, id)).json().dueRules as { uf: string; dueDayOfPeriod: number; dueBusinessDayRoll: string }[]
    expect(rules.map((r) => [r.uf, r.dueDayOfPeriod, r.dueBusinessDayRoll]).sort()).toEqual([['AL', 10, 'BACKWARD'], ['SE', 15, 'FORWARD']])

    expect((await patch(c, id, { dueRules: [SE] })).statusCode).toBe(200)
    expect(((await get(c, id)).json().dueRules as { uf: string }[]).map((r) => r.uf)).toEqual(['SE'])

    const city = await create(c, { dueScope: 'CITY', dueRules: [ARACAJU] })
    expect((await get(c, city.json().id)).json().dueRules[0]).toMatchObject({ ibgeCityCode: 2800308, municipality: { name: 'Aracaju', uf: 'SE' } })
  })

  it('changing the scope needs the rules of the new scope', async () => {
    const c = await setup()
    const id = (await create(c, { dueScope: 'STATE', dueRules: [SE] })).json().id as string
    await expect400(await patch(c, id, { dueScope: 'CITY' }), 'Envie as exceções da nova abrangência')
    expect((await patch(c, id, { dueScope: 'CITY', dueRules: [ARACAJU] })).statusCode).toBe(200)
    expect((await patch(c, id, { dueScope: 'FEDERAL', dueRules: [] })).statusCode).toBe(200)
    expect((await get(c, id)).json()).toMatchObject({ dueScope: 'FEDERAL', dueRules: [] })
  })

  it('changing to weekly keeps the stored rules valid or refuses', async () => {
    const c = await setup()
    const id = (await create(c, { dueScope: 'STATE', dueRules: [SE] })).json().id as string
    await expect400(await patch(c, id, { periodicity: 'WEEKLY', dueDayOfPeriod: 5 }), 'Periodicidade semanal: dia do vencimento deve ser de 1 (segunda) a 7 (domingo)')
  })

  it('another office template stays out of reach', async () => {
    const c = await setup()
    const other = await setup()
    const id = (await create(other, { dueScope: 'STATE', dueRules: [SE] })).json().id as string
    expect((await patch(c, id, { dueRules: [AL] })).statusCode).toBe(404)
  })
})
