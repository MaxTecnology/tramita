import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import * as cnpjws from '@/lib/cnpj-lookup'
import {
  createClient,
  updateClient,
  deleteClient,
  listAssignments,
  lookupClientByCnpj,
  listClientUserLinks,
  searchClientUsers,
} from '@/modules/clients/clients.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestClientUser,
  createTestDepartment,
  grantClientAccess,
  generateValidCnpj,
  createTestBoard,
  createTestColumn,
  createTestTask,
  serveClientDepartment,
} from '@/test/helpers'
import { clientBodySchema, type ClientBody } from '@/modules/clients/clients.schema'


async function setupOrg() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id)
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const folha = await createTestDepartment(org.id, { name: 'Folha' })
  return { org, admin, fiscal, folha }
}

let bodyCounter = 0

function body(overrides: Partial<ClientBody> & Pick<ClientBody, 'departments' | 'clientUsers'>): ClientBody {
  const n = ++bodyCounter
  return {
    name: 'ACME LTDA',
    codigo: `COD-${Date.now()}-${n}`,
    clientType: 'PJ',
    cnpj: generateCnpj(n),
    cpf: null,
    cei: null, caepf: null, inscricaoEstadual: null,
    whatsapp: null, phone: null, notes: null,
    cep: '57312675', estado: 'AL', cidade: 'Arapiraca', bairro: 'Centro', logradouro: 'Rua A', numero: '10',
    complemento: null,
    ...overrides,
  }
}

function generateCnpj(n: number): string {
  return generateValidCnpj(Date.now() * 1000 + n)
}

function newUser(departmentIds: string[], email = `cu-${Date.now()}-${++bodyCounter}@test.com`) {
  return { name: 'Contato', email, password: 'Senha@1234', departmentIds }
}

describe('createClient', () => {
  it('cria cliente, departamentos atendidos, responsáveis e usuário com acesso numa transação', async () => {
    const { org, admin, fiscal, folha } = await setupOrg()

    const client = await createClient(org.id, body({
      departments: [
        { departmentId: fiscal.id, responsibleUserId: admin.id },
        { departmentId: folha.id, responsibleUserId: admin.id },
      ],
      clientUsers: [newUser([fiscal.id, folha.id])],
    }))

    expect(await prisma.clientAssignment.count({ where: { clientId: client.id } })).toBe(2)
    expect(await prisma.clientUserAccess.count({ where: { clientId: client.id } })).toBe(2)
    expect(await prisma.clientUser.count({ where: { organizationId: org.id } })).toBe(1)
  })

  it('normaliza o CNPJ para dígitos e persiste cei/caepf/inscricaoEstadual', async () => {
    const { org, admin, fiscal } = await setupOrg()

    const client = await createClient(org.id, clientBodySchema.parse(body({
      cnpj: '11.222.333/0001-81',
      cei: '123', caepf: '456', inscricaoEstadual: '789',
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [newUser([fiscal.id])],
    })))

    const saved = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(saved).toMatchObject({ cnpj: '11222333000181', cei: '123', caepf: '456', inscricaoEstadual: '789' })
  })

  it('vincula usuário existente via existingId sem duplicar', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const { clientUser } = await createTestClientUser(org.id)

    const client = await createClient(org.id, body({
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [{ existingId: clientUser.id, departmentIds: [fiscal.id] }],
    }))

    expect(await prisma.clientUser.count({ where: { organizationId: org.id } })).toBe(1)
    expect(await prisma.clientUserAccess.count({ where: { clientId: client.id, clientUserId: clientUser.id } })).toBe(1)
  })

  it('recusa responsável de outra organização ou inativo', async () => {
    const { org, fiscal } = await setupOrg()
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)
    const outsider = await createTestUser(otherOrg.id)
    const inactive = await createTestUser(org.id, { isActive: false })

    for (const responsible of [outsider, inactive]) {
      await expect(createClient(org.id, body({
        departments: [{ departmentId: fiscal.id, responsibleUserId: responsible.id }],
        clientUsers: [newUser([fiscal.id])],
      }))).rejects.toMatchObject({ statusCode: 400, message: 'Responsável inválido para o departamento Fiscal' })
    }
  })

  it('recusa departamento de outra organização com 404', async () => {
    const { org, admin } = await setupOrg()
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)
    const foreign = await createTestDepartment(otherOrg.id)

    await expect(createClient(org.id, body({
      departments: [{ departmentId: foreign.id, responsibleUserId: admin.id }],
      clientUsers: [newUser([foreign.id])],
    }))).rejects.toMatchObject({ statusCode: 404, message: 'Departamento não encontrado' })
  })

  it('recusa departamento atendido sem usuário e não grava nada', async () => {
    const { org, admin, fiscal, folha } = await setupOrg()

    await expect(createClient(org.id, body({
      departments: [
        { departmentId: fiscal.id, responsibleUserId: admin.id },
        { departmentId: folha.id, responsibleUserId: admin.id },
      ],
      clientUsers: [newUser([fiscal.id])],
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'O departamento Folha precisa de pelo menos um usuário do cliente com acesso.',
    })

    expect(await prisma.client.count({ where: { organizationId: org.id } })).toBe(0)
    expect(await prisma.clientUser.count({ where: { organizationId: org.id } })).toBe(0)
  })

  it('recusa CNPJ, CPF e código já usados por cliente ativo com 409', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const deps = [{ departmentId: fiscal.id, responsibleUserId: admin.id }]
    await createClient(org.id, body({ codigo: 'X1', cnpj: '11222333000181', departments: deps, clientUsers: [newUser([fiscal.id])] }))
    await createClient(org.id, body({
      codigo: 'X2', clientType: 'PF', cnpj: null, cpf: '52998224725', departments: deps, clientUsers: [newUser([fiscal.id])],
    }))

    await expect(createClient(org.id, body({ cnpj: '11222333000181', departments: deps, clientUsers: [newUser([fiscal.id])] })))
      .rejects.toMatchObject({ statusCode: 409, message: 'Já existe um cliente ativo com este CNPJ nesta organização' })
    await expect(createClient(org.id, body({
      clientType: 'PF', cnpj: null, cpf: '52998224725', departments: deps, clientUsers: [newUser([fiscal.id])],
    }))).rejects.toMatchObject({ statusCode: 409, message: 'Já existe um cliente ativo com este CPF nesta organização' })
    await expect(createClient(org.id, body({ codigo: 'X1', departments: deps, clientUsers: [newUser([fiscal.id])] })))
      .rejects.toMatchObject({ statusCode: 409, message: 'Já existe um cliente com este código nesta organização' })
  })

  it('permite o mesmo código em organizações diferentes', async () => {
    const a = await setupOrg()
    const b = await setupOrg()

    await createClient(a.org.id, body({
      codigo: 'MESMO', departments: [{ departmentId: a.fiscal.id, responsibleUserId: a.admin.id }], clientUsers: [newUser([a.fiscal.id])],
    }))
    await expect(createClient(b.org.id, body({
      codigo: 'MESMO', departments: [{ departmentId: b.fiscal.id, responsibleUserId: b.admin.id }], clientUsers: [newUser([b.fiscal.id])],
    }))).resolves.toBeTruthy()
  })

  it('recusa existingId de usuário de outra organização com 404', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)
    const { clientUser } = await createTestClientUser(otherOrg.id)

    await expect(createClient(org.id, body({
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [{ existingId: clientUser.id, departmentIds: [fiscal.id] }],
    }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateClient', () => {
  async function createServedClient() {
    const ctx = await setupOrg()
    const client = await createClient(ctx.org.id, body({
      departments: [
        { departmentId: ctx.fiscal.id, responsibleUserId: ctx.admin.id },
        { departmentId: ctx.folha.id, responsibleUserId: ctx.admin.id },
      ],
      clientUsers: [newUser([ctx.fiscal.id, ctx.folha.id])],
    }))
    const [link] = await listClientUserLinks(client.id, ctx.org.id)
    return { ...ctx, client, clientUserId: link.existingId }
  }

  it('atualiza os dados da empresa e troca o responsável de um departamento', async () => {
    const { org, admin, fiscal, folha, client, clientUserId } = await createServedClient()
    const other = await createTestUser(org.id, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })

    await updateClient(client.id, org.id, body({
      codigo: client.codigo, cnpj: client.cnpj, notes: 'nova nota',
      departments: [
        { departmentId: fiscal.id, responsibleUserId: other.id },
        { departmentId: folha.id, responsibleUserId: admin.id },
      ],
      clientUsers: [{ existingId: clientUserId, departmentIds: [fiscal.id, folha.id] }],
    }))

    const saved = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(saved.notes).toBe('nova nota')
    const fiscalAssignment = await prisma.clientAssignment.findUniqueOrThrow({
      where: { clientId_departmentId: { clientId: client.id, departmentId: fiscal.id } },
    })
    expect(fiscalAssignment.userId).toBe(other.id)
  })

  it('desmarca departamento sem pendências removendo responsável e acessos dele', async () => {
    const { org, admin, fiscal, folha, client, clientUserId } = await createServedClient()

    await updateClient(client.id, org.id, body({
      codigo: client.codigo, cnpj: client.cnpj,
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [{ existingId: clientUserId, departmentIds: [fiscal.id] }],
    }))

    expect(await prisma.clientAssignment.count({ where: { clientId: client.id, departmentId: folha.id } })).toBe(0)
    expect(await prisma.clientUserAccess.count({ where: { clientId: client.id, departmentId: folha.id } })).toBe(0)
    expect(await prisma.clientUserAccess.count({ where: { clientId: client.id, departmentId: fiscal.id } })).toBe(1)
  })

  it('recusa desmarcar departamento com tarefa aberta e não altera nada', async () => {
    const { org, admin, fiscal, folha, client, clientUserId } = await createServedClient()
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    await createTestTask(column.id, admin.id, { departmentId: folha.id })

    await expect(updateClient(client.id, org.id, body({
      codigo: client.codigo, cnpj: client.cnpj, notes: 'não deve gravar',
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [{ existingId: clientUserId, departmentIds: [fiscal.id] }],
    }))).rejects.toMatchObject({ statusCode: 409 })

    expect(await prisma.clientAssignment.count({ where: { clientId: client.id } })).toBe(2)
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).notes).toBeNull()
  })

  it('remove os acessos de um usuário omitido do payload', async () => {
    const { org, admin, fiscal, folha, client, clientUserId } = await createServedClient()

    await updateClient(client.id, org.id, body({
      codigo: client.codigo, cnpj: client.cnpj,
      departments: [
        { departmentId: fiscal.id, responsibleUserId: admin.id },
        { departmentId: folha.id, responsibleUserId: admin.id },
      ],
      clientUsers: [newUser([fiscal.id, folha.id])],
    }))

    expect(await prisma.clientUserAccess.count({ where: { clientId: client.id, clientUserId } })).toBe(0)
  })

  it('retorna 404 para cliente de outra organização', async () => {
    const { fiscal, admin, client } = await createServedClient()
    const plan = await createTestPlan()
    const otherOrg = await createTestOrg(plan.id)

    await expect(updateClient(client.id, otherOrg.id, body({
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [newUser([fiscal.id])],
    }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteClient', () => {
  it('soft-deletes by setting isActive to false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    await deleteClient(client.id, org.id)

    const saved = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(saved.isActive).toBe(false)
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(deleteClient(client.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('listAssignments', () => {
  it('lista os departamentos atendidos com o responsável', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const client = await createTestClient(org.id)
    await serveClientDepartment(client.id, fiscal.id, admin.id)

    const result = await listAssignments(client.id, org.id)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ departmentId: fiscal.id, userId: admin.id })
  })
})

describe('listClientUserLinks', () => {
  it('returns one entry per ClientUser with all department ids for that client grouped together', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const deptA = await createTestDepartment(org.id)
    const deptB = await createTestDepartment(org.id)

    const { clientUser: singleDeptUser } = await createTestClientUser(org.id, { name: 'Single Dept', email: `single-${Date.now()}@test.com` })
    await grantClientAccess(singleDeptUser.id, client.id, deptA.id)

    const { clientUser: multiDeptUser } = await createTestClientUser(org.id, { name: 'Multi Dept', email: `multi-${Date.now()}@test.com` })
    await grantClientAccess(multiDeptUser.id, client.id, deptA.id)
    await grantClientAccess(multiDeptUser.id, client.id, deptB.id)

    const result = await listClientUserLinks(client.id, org.id)

    expect(result).toHaveLength(2)
    const single = result.find((r) => r.existingId === singleDeptUser.id)
    const multi = result.find((r) => r.existingId === multiDeptUser.id)
    expect(single).toMatchObject({ name: 'Single Dept', departmentIds: [deptA.id] })
    expect(multi?.name).toBe('Multi Dept')
    expect(multi?.departmentIds.sort()).toEqual([deptA.id, deptB.id].sort())
  })

  it('returns an empty array when the client has no linked users', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    const result = await listClientUserLinks(client.id, org.id)

    expect(result).toEqual([])
  })

  it('throws 404 when client belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)

    await expect(listClientUserLinks(client.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('lookupClientByCnpj', () => {
  afterEach(() => vi.restoreAllMocks())

  const found = (over: Partial<cnpjws.CnpjLookupResult>): cnpjws.CnpjLookupResult => ({
    razaoSocial: 'Cliente Teste LTDA', nomeFantasia: null, cep: '49000000', estado: 'SE', cidade: 'ARACAJU',
    ibgeCityCode: 2800308, bairro: 'Centro', logradouro: 'RUA das Flores', numero: '123', complemento: null, ...over,
  })

  it('returns the city name from the IBGE table when the service brings the code', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockResolvedValue(found({}))
    const result = await lookupClientByCnpj('11.222.333/0001-81')
    expect(cnpjws.lookupCnpj).toHaveBeenCalledWith('11222333000181')
    expect(result).toMatchObject({ razaoSocial: 'Cliente Teste LTDA', estado: 'SE', cidade: 'Aracaju', ibgeCityCode: 2800308 })
  })

  it('without the code (reserve service), finds the city by name + state', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockResolvedValue(found({ estado: 'AL', cidade: 'MACEIO', ibgeCityCode: null }))
    expect(await lookupClientByCnpj('11222333000181')).toMatchObject({ estado: 'AL', cidade: 'Maceió', ibgeCityCode: 2704302 })
  })

  it('a code missing from the table (new municipality) leaves the city to be chosen, no error', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockResolvedValue(found({ cidade: 'CIDADE NOVA', ibgeCityCode: 2899999 }))
    expect(await lookupClientByCnpj('11222333000181')).toMatchObject({ estado: 'SE', cidade: 'CIDADE NOVA', ibgeCityCode: null })
  })

  it('a code of another state than the one informed is not trusted', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockResolvedValue(found({ estado: 'AL', ibgeCityCode: 2800308 }))
    expect(await lookupClientByCnpj('11222333000181')).toMatchObject({ estado: 'AL', ibgeCityCode: null })
  })

  it('throws 400 when the CNPJ does not have 14 digits, without calling the service', async () => {
    const spy = vi.spyOn(cnpjws, 'lookupCnpj')
    await expect(lookupClientByCnpj('123')).rejects.toMatchObject({ statusCode: 400, message: 'CNPJ inválido' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('not found → 404', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockRejectedValue(new cnpjws.CnpjNotFoundError())
    await expect(lookupClientByCnpj('11222333000181')).rejects.toMatchObject({ statusCode: 404, message: 'CNPJ não encontrado' })
  })

  it('both services down → 502 telling to try again or fill in by hand', async () => {
    vi.spyOn(cnpjws, 'lookupCnpj').mockRejectedValue(new cnpjws.CnpjUnavailableError())
    await expect(lookupClientByCnpj('11222333000181')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Serviço de consulta de CNPJ indisponível no momento. Tente de novo ou preencha os dados à mão.',
    })
  })
})

describe('unicidade de CNPJ entre clientes ativos (índice parcial no banco)', () => {
  it('recusa o mesmo CNPJ em dois clientes ativos da mesma organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id, { cnpj: '11222333000181' })

    await expect(createTestClient(org.id, { cnpj: '11222333000181' })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  it('permite reaproveitar o CNPJ de um cliente desativado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id, { cnpj: '11222333000181', isActive: false })

    await expect(createTestClient(org.id, { cnpj: '11222333000181' })).resolves.toBeTruthy()
  })
})

describe('telefone dos usuários do cliente nas listagens do formulário', () => {
  it('listClientUserLinks e searchClientUsers devolvem o telefone (pro aviso de WhatsApp no painel de cobertura)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const dept = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id, { name: 'Com Telefone' })
    await prisma.clientUser.update({ where: { id: clientUser.id }, data: { phone: '5582999991234' } })
    await grantClientAccess(clientUser.id, client.id, dept.id)

    const [link] = await listClientUserLinks(client.id, org.id)
    const [found] = await searchClientUsers(org.id, 'Com Telefone')

    expect(link.phone).toBe('5582999991234')
    expect(found.phone).toBe('5582999991234')
  })
})

describe('cobertura ignora usuário do portal inativo', () => {
  it('recusa salvar quando o único usuário de um departamento está inativo', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const { clientUser: inactive } = await createTestClientUser(org.id, { isActive: false })

    await expect(createClient(org.id, body({
      departments: [{ departmentId: fiscal.id, responsibleUserId: admin.id }],
      clientUsers: [{ existingId: inactive.id, departmentIds: [fiscal.id] }],
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'O departamento Fiscal precisa de pelo menos um usuário do cliente com acesso.',
    })
  })

  it('listClientUserLinks devolve isActive pra tela não contar o inativo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const dept = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id, { isActive: false })
    await grantClientAccess(clientUser.id, client.id, dept.id)

    const [link] = await listClientUserLinks(client.id, org.id)

    expect(link.isActive).toBe(false)
  })
})

describe('mesmo CNPJ com e sem máscara', () => {
  it('é tratado como o mesmo cliente → 409 no segundo cadastro', async () => {
    const { org, admin, fiscal } = await setupOrg()
    const deps = [{ departmentId: fiscal.id, responsibleUserId: admin.id }]
    await createClient(org.id, clientBodySchema.parse(body({ cnpj: '11.222.333/0001-81', departments: deps, clientUsers: [newUser([fiscal.id])] })))

    await expect(createClient(org.id, clientBodySchema.parse(body({ cnpj: '11222333000181', departments: deps, clientUsers: [newUser([fiscal.id])] }))))
      .rejects.toMatchObject({ statusCode: 409, message: 'Já existe um cliente ativo com este CNPJ nesta organização' })
  })
})
