import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, getAuthHeader,
} from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const dani = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
  const brunaSem = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id], seesDepartmentWork: false })
  const a = await createTestClient(org.id)
  const b = await createTestClient(org.id)
  await serveClientDepartment(a.id, fiscal.id, carlos.id)
  await serveClientDepartment(b.id, folha.id, dani.id)
  return { a, b, brunaAuth: await getAuthHeader(bruna.email, 'Test@1234'), brunaSemAuth: await getAuthHeader(brunaSem.email, 'Test@1234') }
}

const create = (auth: string, clientId: string) =>
  app.inject({ method: 'POST', url: '/boards', headers: { authorization: auth }, payload: { title: 'Processo', clientId } })

describe('criar processo no escopo', () => {
  it('a member creates a process for a client of their department, not of another', async () => {
    const c = await setup()
    expect((await create(c.brunaAuth, c.a.id)).statusCode).toBe(201)
    const other = await create(c.brunaAuth, c.b.id)
    expect(other.statusCode).toBe(404)
    expect(JSON.parse(other.body).message).toBe('Cliente não encontrado')
  })

  it('without "see colleagues", only clients of their own portfolio', async () => {
    const c = await setup()
    expect((await create(c.brunaSemAuth, c.a.id)).statusCode).toBe(404)
  })
})
