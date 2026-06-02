// apps/api/src/lib/maximizebot.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'
import { sendWhatsApp } from '@/lib/maximizebot'

vi.mock('axios')

describe('sendWhatsApp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls MaximizeBot API with correct URL, payload and Authorization header', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} })

    await sendWhatsApp('Bearer test-token', {
      number: '5582999990001',
      body: 'Olá, João!',
      saveOnTicket: true,
      startChatbot: false,
      linkPreview: true,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://app.maximizebot.com.br/backend/api/messages/send',
      {
        number: '5582999990001',
        body: 'Olá, João!',
        saveOnTicket: true,
        startChatbot: false,
        linkPreview: true,
      },
      { headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } },
    )
  })

  it('throws when axios rejects', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('Network error'))
    await expect(
      sendWhatsApp('Bearer token', { number: '55829', body: 'test' }),
    ).rejects.toThrow('Network error')
  })
})
