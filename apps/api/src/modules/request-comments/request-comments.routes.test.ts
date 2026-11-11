// apps/api/src/modules/request-comments/request-comments.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestClientUser, createTestDepartment, grantClientAccess, getAuthHeader,
  createTestRequest,
} from '@/test/helpers'
import { createRequest } from '@/modules/requests/requests.service'

describe('POST /requests/:requestId/comments', () => {
  it('ORG_MEMBER comenta e cliente consegue ler depois', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido' })

    const authStaff = await getAuthHeader(member.email, 'Test@1234')
    const created = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authStaff },
      payload: { content: 'Pode detalhar?' },
    })
    expect(created.statusCode).toBe(201)

    const authClient = await getAuthHeader(clientUser.email, password)
    const list = await app.inject({
      method: 'GET',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authClient },
    })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toHaveLength(1)
  })

  it('lança 400 quando o content é só espaços em branco', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido' })
    const authStaff = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authStaff },
      payload: { content: '   ' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('lança 400 quando o content excede o limite de tamanho', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido' })
    const authStaff = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authStaff },
      payload: { content: 'x'.repeat(4001) },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /request-comments/:id', () => {
  it('autor remove o próprio comentário', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const created = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Meu comentário' },
    })
    const comment = JSON.parse(created.body)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/request-comments/${comment.id}`,
      headers: { authorization: auth },
    })
    expect(deleted.statusCode).toBe(200)
  })
})
