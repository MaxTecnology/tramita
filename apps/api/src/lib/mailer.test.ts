import { vi, describe, it, expect, afterEach } from 'vitest'
import { Resend } from 'resend'
import { sendEmail } from '@/lib/mailer'

describe('sendEmail', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends email via Resend without error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({ data: { id: 'test-id' }, error: null, headers: null })

    await expect(sendEmail('cliente@exemplo.com', 'Assunto', 'Corpo')).resolves.not.toThrow()
  })

  it('throws when Resend returns an error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({
      data: null,
      error: { message: 'API error', name: 'application_error', statusCode: 500 },
      headers: null,
    })

    await expect(sendEmail('to@test.com', 'subject', 'body')).rejects.toThrow('API error')
  })

  it('missing RESEND_API_KEY never breaks importing the mailer, only the e-mail send', async () => {
    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    vi.resetModules()
    try {
      const fresh = await import('@/lib/mailer') // the worker imports this at boot
      await expect(fresh.sendEmail('to@test.com', 's', 'b')).rejects.toThrow('RESEND_API_KEY não configurada')
    } finally {
      process.env.RESEND_API_KEY = saved
    }
  })
})
