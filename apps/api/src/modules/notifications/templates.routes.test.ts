// apps/api/src/modules/notifications/templates.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'

describe('POST /notifications/templates/preview', () => {
  it('renders preview with provided body and fictional vars', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates/preview',
      headers: { authorization: auth },
      payload: {
        event: 'TASK_MOVED',
        channel: 'WHATSAPP',
        body: 'Olá, {{clientName}}! Processo {{taskTitle}} → {{toColumn}}.',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.rendered).toContain('João Silva')
    expect(body.rendered).toContain('Abertura de LTDA')
    expect(body.rendered).toContain('Em Revisão')
  })

  it('uses default template when body is not provided', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates/preview',
      headers: { authorization: auth },
      payload: { event: 'TASK_MOVED', channel: 'WHATSAPP' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).rendered).toBeTruthy()
  })
})

describe('PUT /notifications/templates/:event/:channel', () => {
  it('persists and returns custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'PUT',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
      payload: { body: 'Template customizado {{clientName}}' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).body).toBe('Template customizado {{clientName}}')
  })
})

describe('GET /notifications/templates/:event/:channel', () => {
  it('returns default template with isDefault=true when org has no custom', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.body).toBe(DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body)
    expect(body.isDefault).toBe(true)
  })

  it('returns isDefault=false when org has custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    await app.inject({
      method: 'PUT',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
      payload: { body: 'Template da org' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
    })

    expect(JSON.parse(res.body).isDefault).toBe(false)
  })
})

describe('PATCH /notifications/config — eventos de request', () => {
  it('atualiza e retorna os booleans de request', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const patch = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { requestCreated: false, requestApproved: true, requestRejected: false },
    })
    expect(patch.statusCode).toBe(200)

    const get = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    const body = JSON.parse(get.body)
    expect(body.requestCreated).toBe(false)
    expect(body.requestApproved).toBe(true)
    expect(body.requestRejected).toBe(false)
  })
})
