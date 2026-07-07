import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Tramita <notificacoes@autohubs.com.br>'

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  fromOverride?: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: fromOverride ?? EMAIL_FROM,
    to,
    subject,
    text: body,
  })
  if (error) throw new Error(error.message)
}
