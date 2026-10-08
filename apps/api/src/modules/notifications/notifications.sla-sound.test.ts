import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { prisma } from '@/lib/prisma'
import * as b2Module from '@/lib/b2'

beforeEach(() => {
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'deleteFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed.example/test.mp3')
})

describe('POST/DELETE /notifications/config/sla-sound', () => {
  it('faz upload, persiste a key e depois remove', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const form = Buffer.from('fake-mp3-bytes')
    const boundary = '----testboundary'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="aviso.mp3"\r\n' +
      'Content-Type: audio/mpeg\r\n\r\n' +
      `${form.toString('binary')}\r\n` +
      `--${boundary}--\r\n`

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(uploadRes.statusCode).toBe(201)

    const config = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(config?.customSlaSoundKey).toBe(`sla-sounds/${org.id}.mp3`)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth },
    })
    expect(deleteRes.statusCode).toBe(204)

    const configAfter = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(configAfter?.customSlaSoundKey).toBeNull()
  })

  it('rejeita tipo de arquivo não permitido', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary2'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="virus.exe"\r\n' +
      'Content-Type: application/x-msdownload\r\n\r\n' +
      'bytes\r\n' +
      `--${boundary}--\r\n`

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(422)
  })
})
