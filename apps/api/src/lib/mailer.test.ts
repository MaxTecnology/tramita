import { vi, describe, it, expect, afterEach } from 'vitest'
import { Resend } from 'resend'
import { sendEmail } from '@/lib/mailer'

describe('sendEmail', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends email via Resend without error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({ data: { id: 'test-id' }, error: null })

    await expect(sendEmail('cliente@exemplo.com', 'Assunto', 'Corpo')).resolves.not.toThrow()
  })

  it('throws when Resend returns an error', async () => {
    vi.spyOn(Resend.prototype, 'post').mockResolvedValue({
      data: null,
      error: { message: 'API error', name: 'api_error' },
    })

    await expect(sendEmail('to@test.com', 'subject', 'body')).rejects.toThrow('API error')
  })
})
