// apps/api/src/lib/maximizebot.ts
import axios from 'axios'

export interface SendWhatsAppPayload {
  number: string
  body: string
  saveOnTicket?: boolean
  startChatbot?: boolean
  linkPreview?: boolean
}

export async function sendWhatsApp(token: string, payload: SendWhatsAppPayload): Promise<void> {
  await axios.post(
    'https://app.maximizebot.com.br/backend/api/messages/send',
    payload,
    { headers: { Authorization: token, 'Content-Type': 'application/json' } },
  )
}
