// apps/api/src/lib/mailer.ts
import nodemailer from 'nodemailer'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string  // já decriptografado antes de chamar esta função
  from: string
}

export async function sendEmail(
  config: SmtpConfig,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: { user: config.user, pass: config.pass },
  })
  await transporter.sendMail({ from: config.from, to, subject, text: body })
}
