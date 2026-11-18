import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, createTestClientUser, getAuthHeader } from '@/test/helpers'
import { findMunicipality, findMunicipalityByName } from '@/modules/municipalities/municipalities.service'

async function staffAuth() {
  const org = await createTestOrg((await createTestPlan()).id)
  const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  return { org, auth: await getAuthHeader(user.email, 'Test@1234') }
}

const list = (auth: string | undefined, query: string) =>
  app.inject({ method: 'GET', url: `/municipalities${query}`, headers: auth ? { authorization: auth } : {} })

describe('municípios (IBGE)', () => {
  it('lists the cities of a state, sorted by name', async () => {
    const { auth } = await staffAuth()
    const res = await list(auth, '?uf=SE')
    expect(res.statusCode).toBe(200)
    const cities = JSON.parse(res.body) as { ibgeCode: number; name: string }[]
    expect(cities).toContainEqual({ ibgeCode: 2800308, name: 'Aracaju' })
    expect(cities.length).toBe(75)
    const names = cities.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')))
  })

  it('refuses an unknown or missing state', async () => {
    const { auth } = await staffAuth()
    const bad = await list(auth, '?uf=XX')
    expect(bad.statusCode).toBe(400)
    expect(JSON.parse(bad.body)).toEqual({ message: 'Estado inválido' })
    expect((await list(auth, '')).statusCode).toBe(400)
  })

  it('is for the office team: no token → 401, portal client → 403', async () => {
    expect((await list(undefined, '?uf=SE')).statusCode).toBe(401)
    const org = await createTestOrg((await createTestPlan()).id)
    const { clientUser, password } = await createTestClientUser(org.id)
    expect((await list(await getAuthHeader(clientUser.email, password), '?uf=SE')).statusCode).toBe(403)
  })

  it('finds a city by code and by name + state, ignoring accents and case', async () => {
    expect(await findMunicipality(2704302)).toEqual({ ibgeCode: 2704302, name: 'Maceió', uf: 'AL' })
    expect(await findMunicipality(9999999)).toBeNull()
    expect((await findMunicipalityByName('MACEIO', 'AL'))?.ibgeCode).toBe(2704302)
    expect(await findMunicipalityByName('Maceió', 'SE')).toBeNull()
  })

  it('accents, apostrophes and extra spaces in the typed name still match', async () => {
    expect((await findMunicipalityByName('SAO  CRISTOVAO', 'SE'))?.ibgeCode).toBe(2806701)
    expect((await findMunicipalityByName("itaporanga d'ajuda", 'SE'))?.ibgeCode).toBe(2803203)
  })
})

