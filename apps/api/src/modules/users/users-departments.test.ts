import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, getAuthHeader,
} from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  return { org, admin, fiscal, folha, auth: await getAuthHeader(admin.email, 'Test@1234') }
}

const body = (extra: object) => ({ name: 'Bruna', email: `bruna-${Math.random()}@x.com`, password: 'Senha@123', role: 'ORG_MEMBER', ...extra })

describe('departamentos no cadastro de usuários', () => {
  it('creating a member requires at least one department', async () => {
    const { auth } = await setup()
    const res = await app.inject({ method: 'POST', url: '/users', headers: { authorization: auth }, payload: body({}) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toBe('Selecione pelo menos um departamento')
  })

  it('creates with departments and sees colleagues by default', async () => {
    const { auth, fiscal } = await setup()
    const res = await app.inject({ method: 'POST', url: '/users', headers: { authorization: auth }, payload: body({ departmentIds: [fiscal.id] }) })
    expect(res.statusCode).toBe(201)
    const created = JSON.parse(res.body)
    expect(created.departments).toEqual([{ id: fiscal.id, name: 'Fiscal' }])
    expect(created.seesDepartmentWork).toBe(true)
  })

  it('a department of another organization is refused', async () => {
    const { auth } = await setup()
    const other = await createTestOrg((await createTestPlan()).id)
    const foreign = await createTestDepartment(other.id, { name: 'Fiscal' })
    const res = await app.inject({ method: 'POST', url: '/users', headers: { authorization: auth }, payload: body({ departmentIds: [foreign.id] }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toBe('Departamento inválido')
  })

  it('turns "see colleagues" off', async () => {
    const { org, auth, fiscal } = await setup()
    const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
    const res = await app.inject({ method: 'PATCH', url: `/users/${bruna.id}`, headers: { authorization: auth }, payload: { seesDepartmentWork: false } })
    expect(res.statusCode).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bruna.id } })).seesDepartmentWork).toBe(false)
  })

  it('removing a department where the user is responsible for an active client is refused', async () => {
    const { org, auth, fiscal, folha } = await setup()
    const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [fiscal.id] })
    const client = await createTestClient(org.id)
    await serveClientDepartment(client.id, fiscal.id, bruna.id)

    const res = await app.inject({ method: 'PATCH', url: `/users/${bruna.id}`, headers: { authorization: auth }, payload: { departmentIds: [folha.id] } })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).message).toBe('Transfira as responsabilidades antes de tirar Bruna do departamento Fiscal')
    expect(await prisma.userDepartment.count({ where: { userId: bruna.id, departmentId: fiscal.id } })).toBe(1)
  })

  it('moving a user without responsibilities to another department works', async () => {
    const { org, auth, fiscal, folha } = await setup()
    const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
    const res = await app.inject({ method: 'PATCH', url: `/users/${bruna.id}`, headers: { authorization: auth }, payload: { departmentIds: [folha.id] } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).departments).toEqual([{ id: folha.id, name: 'Folha' }])
  })

  it('/users/me returns the role, departments and the option', async () => {
    const { org, fiscal } = await setup()
    const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })
    const res = await app.inject({ method: 'GET', url: '/users/me', headers: { authorization: await getAuthHeader(bruna.email, 'Test@1234') } })
    expect(JSON.parse(res.body)).toMatchObject({ role: 'ORG_MEMBER', departments: [{ id: fiscal.id, name: 'Fiscal' }], seesDepartmentWork: true })
  })
})
