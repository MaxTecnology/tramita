// apps/api/src/lib/mailer.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import nodemailer from 'nodemailer'
import { sendEmail, type SmtpConfig } from '@/lib/mailer'

vi.mock('nodemailer')

const TEST_CONFIG: SmtpConfig = {
  host: 'smtp.test.com',
  port: 587,
  user: 'user@test.com',
  pass: 'senha123',
  from: 'Test <noreply@test.com>',
}

describe('sendEmail', () => {
  const mockSendMail = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: mockSendMail.mockResolvedValue({}),
    } as any)
  })

  it('calls sendMail with correct to, subject and text', async () => {
    await sendEmail(TEST_CONFIG, 'cliente@exemplo.com', 'Assunto do email', 'Corpo do email')

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'Test <noreply@test.com>',
      to: 'cliente@exemplo.com',
      subject: 'Assunto do email',
      text: 'Corpo do email',
    })
  })

  it('creates transport with correct SMTP config', async () => {
    await sendEmail(TEST_CONFIG, 'to@test.com', 'subject', 'body')

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      auth: { user: 'user@test.com', pass: 'senha123' },
    })
  })

  it('throws when sendMail rejects', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'))
    await expect(sendEmail(TEST_CONFIG, 'to@test.com', 'subject', 'body')).rejects.toThrow('SMTP error')
  })
})
