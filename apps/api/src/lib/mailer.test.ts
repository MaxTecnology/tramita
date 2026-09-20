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
})
