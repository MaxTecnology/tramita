import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, createTestDepartment, getAuthHeader } from '@/test/helpers'

async function setup(role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' = 'ORG_ADMIN') {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id, { role })
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { org, user, auth }
}

const payload = {
  name: 'Abertura de Empresa',
  isActive: true,
  columns: [
    { title: 'Documentação', statusEffect: 'NONE', notifyClient: false, documents: [{ name: 'RG' }] },
  ],
}

describe('POST /process-templates', () => {
  it('ORG_ADMIN creates a template (201)', async () => {
    const { auth } = await setup('ORG_ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/process-templates',
      headers: { authorization: auth },
      payload,
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).name).toBe('Abertura de Empresa')
  })

  it('ORG_MANAGER cannot create (403)', async () => {
    const { auth } = await setup('ORG_MANAGER')

    const res = await app.inject({
      method: 'POST',
      url: '/process-templates',
      headers: { authorization: auth },
      payload,
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('GET /process-templates', () => {
  it('ORG_MEMBER can list (read is open to all roles)', async () => {
    const { auth } = await setup('ORG_MEMBER')

    const res = await app.inject({ method: 'GET', url: '/process-templates', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('lists only the caller org templates', async () => {
    const { auth } = await setup('ORG_ADMIN')
    await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: auth }, payload })

    const { auth: otherAuth } = await setup('ORG_ADMIN')

    const res = await app.inject({ method: 'GET', url: '/process-templates', headers: { authorization: auth } })
    expect(JSON.parse(res.body)).toHaveLength(1)

    const otherRes = await app.inject({ method: 'GET', url: '/process-templates', headers: { authorization: otherAuth } })
    expect(JSON.parse(otherRes.body)).toHaveLength(0)
  })
})

describe('PATCH /process-templates/:id', () => {
  it('returns 404 when the template belongs to another org', async () => {
    const { auth } = await setup('ORG_ADMIN')
    const created = await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: auth }, payload })
    const { id } = JSON.parse(created.body)

    const { auth: otherAuth } = await setup('ORG_ADMIN')
    const res = await app.inject({
      method: 'PATCH',
      url: `/process-templates/${id}`,
      headers: { authorization: otherAuth },
      payload: { name: 'Editado' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /process-templates/:id', () => {
  it('returns 404 when the template belongs to another org', async () => {
    const { auth } = await setup('ORG_ADMIN')
    const created = await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: auth }, payload })
    const { id } = JSON.parse(created.body)

    const { auth: otherAuth } = await setup('ORG_ADMIN')
    const res = await app.inject({
      method: 'DELETE',
      url: `/process-templates/${id}`,
      headers: { authorization: otherAuth },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('Modelo de Processo: prazo, departamento e solicitável', () => {
  it('saves the deadline in business days, the department and "cliente pode solicitar"', async () => {
    const { org, auth } = await setup('ORG_ADMIN')
    const dept = await createTestDepartment(org.id)
    const res = await app.inject({
      method: 'POST', url: '/process-templates', headers: { authorization: auth },
      payload: { ...payload, deadlineBusinessDays: 30, clientCanRequest: true, departmentId: dept.id },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ deadlineBusinessDays: 30, clientCanRequest: true, departmentId: dept.id })
    const id = JSON.parse(res.body).id
    const patched = await app.inject({ method: 'PATCH', url: `/process-templates/${id}`, headers: { authorization: auth }, payload: { deadlineBusinessDays: null, clientCanRequest: false } })
    expect(JSON.parse(patched.body)).toMatchObject({ deadlineBusinessDays: null, clientCanRequest: false, departmentId: dept.id })
  })

  it('a department of another office is not found', async () => {
    const { auth } = await setup('ORG_ADMIN')
    const other = await setup('ORG_ADMIN')
    const foreign = await createTestDepartment(other.org.id)
    const res = await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: auth }, payload: { ...payload, departmentId: foreign.id } })
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([404, 'Departamento não encontrado'])
  })

  it('a client-requestable process needs a department (it decides who evaluates the request)', async () => {
    const { auth } = await setup('ORG_ADMIN')
    const res = await app.inject({ method: 'POST', url: '/process-templates', headers: { authorization: auth }, payload: { ...payload, clientCanRequest: true } })
    expect([res.statusCode, JSON.parse(res.body).message]).toEqual([422, 'Escolha o departamento que avalia os pedidos deste processo'])
  })
})
