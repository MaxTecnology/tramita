import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import * as sse from '@/lib/sse'
import { createClient } from './clients.service'
import type { ClientBody } from './clients.schema'
import { transferResponsibilities } from '@/modules/users/responsibility-transfer.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestDepartment, createTestClient,
  serveClientDepartment, generateValidCnpj, getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(sse, 'publishBoardEvent').mockResolvedValue(undefined)
})

let n = 0
function body(departments: ClientBody['departments'], departmentIds: string[]): ClientBody {
  n++
  return {
    name: 'ACME LTDA', codigo: `RD-${Date.now()}-${n}`, clientType: 'PJ', cnpj: generateValidCnpj(Date.now() * 1000 + n), cpf: null,
    cei: null, caepf: null, inscricaoEstadual: null, whatsapp: null, phone: null, notes: null,
    cep: '57312675', estado: 'AL', cidade: 'Arapiraca', bairro: 'Centro', logradouro: 'Rua A', numero: '10', complemento: null,
    departments,
    clientUsers: [{ name: 'Contato', email: `rd-${Date.now()}-${n}@x.com`, password: 'Senha@1234', departmentIds }],
  }
}

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Bruna', departmentIds: [folha.id] })
  return { org, admin, fiscal, folha, bruna }
}

describe('responsável precisa pertencer ao departamento', () => {
  it('client form refuses a responsible who is not in the department', async () => {
    const { org, fiscal, bruna } = await setup()
    await expect(createClient(org.id, body([{ departmentId: fiscal.id, responsibleUserId: bruna.id }], [fiscal.id])))
      .rejects.toMatchObject({ statusCode: 400, message: 'Bruna não pertence ao departamento Fiscal' })
  })

  it('an admin can be responsible without belonging to the department', async () => {
    const { org, admin, fiscal } = await setup()
    const created = await createClient(org.id, body([{ departmentId: fiscal.id, responsibleUserId: admin.id }], [fiscal.id]))
    expect(created.id).toBeTruthy()
  })

  it('transfer to someone outside the department of a moved responsibility is refused and moves nothing', async () => {
    const { org, admin, fiscal } = await setup()
    const carlos = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Carlos' })
    const dani = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Dani' }) // no departments
    const client = await createTestClient(org.id)
    await serveClientDepartment(client.id, fiscal.id, carlos.id)

    await expect(transferResponsibilities(carlos.id, org.id, { toUserId: dani.id, clientIds: [client.id], includeBoards: true, includeTasks: true }, admin.id))
      .rejects.toMatchObject({ statusCode: 400, message: 'Dani não pertence ao departamento Fiscal' })
    expect((await prisma.clientAssignment.findFirstOrThrow({ where: { clientId: client.id } })).userId).toBe(carlos.id)
  })

  it('/users/options?departmentId lists only members of the department (and admins)', async () => {
    const { org, admin, fiscal, folha, bruna } = await setup()
    const fiscalMember = await createTestUser(org.id, { role: 'ORG_MEMBER', name: 'Fiscal Member', departmentIds: [fiscal.id] })
    const res = await app.inject({ method: 'GET', url: `/users/options?departmentId=${fiscal.id}`, headers: { authorization: await getAuthHeader(admin.email, 'Test@1234') } })
    const ids = (JSON.parse(res.body) as { id: string }[]).map((u) => u.id)
    expect(ids).toContain(fiscalMember.id)
    expect(ids).toContain(admin.id)
    expect(ids).not.toContain(bruna.id)
    void folha
  })
})
