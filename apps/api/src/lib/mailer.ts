import { Resend } from 'resend'

// Created on first send, never at import: a missing key fails the e-mail only, not the boot of the
// worker that imports this module (WhatsApp, document reader and crons keep running).
let client: Resend | null = null
function getResend(): Resend {
  if (!client) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY não configurada — e-mail não enviado')
    client = new Resend(key)
  }
  return client
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string,
  fromOverride?: string,
): Promise<void> {
  const { error } = await getResend().emails.send({
    from: fromOverride ?? process.env.EMAIL_FROM ?? 'Tramita <notificacoes@autohubs.com.br>',
    to,
    subject,
    text: body,
    ...(html ? { html } : {}),
  })
  if (error) throw new Error(error.message)
}
