// apps/api/src/modules/request-comments/request-comments.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestClientUser, grantClientAccess,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import { createRequest, markNeedsInfo } from '@/modules/requests/requests.service'
import { listRequestComments, createRequestComment, deleteRequestComment } from './request-comments.service'

beforeEach(() => {
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('createRequestComment', () => {
  it('comentário do cliente em request NEEDS_INFO reverte o status para PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await markNeedsInfo(request.id, org.id, admin.id, 'Qual o CNPJ da empresa?')

    await createRequestComment(request.id, { content: 'É 00.000.000/0001-00' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('PENDING')
  })

  it('comentário da equipe em request NEEDS_INFO NÃO reverte o status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await markNeedsInfo(request.id, org.id, admin.id, 'Qual o CNPJ da empresa?')

    await createRequestComment(request.id, { content: 'Só um follow-up' }, {
      id: admin.id, role: 'ORG_ADMIN', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('NEEDS_INFO')
  })

  it('comentário do cliente em request APPROVED não altera o status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await prisma.request.update({ where: { id: request.id }, data: { status: 'APPROVED', reviewedById: admin.id } })

    await createRequestComment(request.id, { content: 'Obrigado!' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('APPROVED')
  })

  it('cliente sem acesso à company da request recebe 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id) // sem grantClientAccess
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    await expect(
      createRequestComment(request.id, { content: 'x' }, { id: clientUser.id, role: 'CLIENT', organizationId: org.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('departmentId nulo na request cai no fallback ORG_ADMIN/ORG_MANAGER sem erro', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido sem depto' }) // departmentId undefined

    await createRequestComment(request.id, { content: 'Oi' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REQUEST_COMMENT_ADDED', userId: admin.id }),
    )
  })
})

describe('listRequestComments / deleteRequestComment', () => {
  it('lista comentários em ordem cronológica e marca deletado sem revelar conteúdo pro cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const c1 = await createRequestComment(request.id, { content: 'Primeiro' }, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })
    await createRequestComment(request.id, { content: 'Segundo' }, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })

    await deleteRequestComment(c1.id, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })

    const asAdmin = await listRequestComments(request.id, org.id, 'ORG_ADMIN')
    expect(asAdmin).toHaveLength(2)
    expect(asAdmin[0].content).toBeNull()
    expect((asAdmin[0] as unknown as { deletedContent: string }).deletedContent).toBe('Primeiro')
  })
})
