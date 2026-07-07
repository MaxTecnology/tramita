import { vi, describe, it, expect, beforeEach } from 'vitest'
import { sendEmail } from '@/lib/mailer'

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }) },
  })),
}))

describe('sendEmail', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends email via Resend without error', async () => {
    await expect(sendEmail('cliente@exemplo.com', 'Assunto', 'Corpo')).resolves.not.toThrow()
  })

  it('throws when Resend returns an error', async () => {
    const { Resend } = await import('resend')
    vi.mocked(Resend).mockImplementationOnce(() => ({
      emails: { send: vi.fn().mockResolvedValue({ data: null, error: { message: 'API error', name: 'api_error' } }) },
    }) as any)
    const { sendEmail: send } = await import('@/lib/mailer')
    await expect(send('to@test.com', 'subject', 'body')).rejects.toThrow('API error')
  })
})
