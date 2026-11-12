import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/maximizebot', () => ({ sendWhatsApp: vi.fn() }))

import { sendEmail } from '@/lib/mailer'
import { sendWhatsApp } from '@/lib/maximizebot'

async function adminAuth() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  return { org, auth: await getAuthHeader(user.email, 'Test@1234') }
}

describe('envio de teste com provedor recusando', () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset()
    vi.mocked(sendWhatsApp).mockReset()
  })

  it('e-mail: responde 502 com mensagem clara em vez de 500 genérico', async () => {
    const { auth } = await adminAuth()
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('API key is invalid'))

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/test-email',
      headers: { authorization: auth },
      payload: { to: 'teste@example.com' },
    })

    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).message).toBe(
      'Não foi possível enviar o e-mail de teste: o provedor recusou o envio (API key is invalid).',
    )
  })

  it('WhatsApp: responde 502 com mensagem clara quando o MaximizeBot recusa o token', async () => {
    const { org, auth } = await adminAuth()
    await prisma.notificationConfig.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, maximizebotToken: 'Bearer x' },
      update: { maximizebotToken: 'Bearer x' },
    })
    vi.mocked(sendWhatsApp).mockRejectedValueOnce(new Error('Request failed with status code 401'))

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/test-whatsapp',
      headers: { authorization: auth },
      payload: { number: '5582999999999' },
    })

    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).message).toBe(
      'Não foi possível enviar o WhatsApp de teste: o MaximizeBot recusou o envio (Request failed with status code 401).',
    )
  })
})
