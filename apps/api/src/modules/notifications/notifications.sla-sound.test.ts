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

// Bytes reais de assinatura — necessário agora que a validação checa magic bytes, não só o
// Content-Type declarado pelo cliente (spoofável).
const REAL_MP3_BYTES = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xff, 0xfb])
const REAL_WAV_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE', 'ascii'),
])

function buildMultipartBody(
  boundary: string,
  fields: { label?: string; filename: string; contentType: string; bytes: Buffer },
): string {
  const parts: string[] = []
  if (fields.label !== undefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\n${fields.label}\r\n`)
  }
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fields.filename}"\r\n` +
    `Content-Type: ${fields.contentType}\r\n\r\n` +
    `${fields.bytes.toString('binary')}\r\n`,
  )
  parts.push(`--${boundary}--\r\n`)
  return parts.join('')
}

describe('POST/DELETE /notifications/config/sla-sound', () => {
  it('faz upload de um MP3 real, persiste a key e o label, e depois remove', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary'
    const body = buildMultipartBody(boundary, {
      label: 'Som do escritório G2A',
      filename: 'aviso.mp3',
      contentType: 'audio/mpeg',
      bytes: REAL_MP3_BYTES,
    })

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(uploadRes.statusCode).toBe(201)

    const config = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(config?.customSlaSoundKey).toBe(`sla-sounds/${org.id}.mp3`)
    expect(config?.customSlaSoundLabel).toBe('Som do escritório G2A')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth },
    })
    expect(deleteRes.statusCode).toBe(204)

    const configAfter = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(configAfter?.customSlaSoundKey).toBeNull()
  })

  it('faz upload de um WAV real com a extensão correta na key', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary-wav'
    const body = buildMultipartBody(boundary, {
      filename: 'aviso.wav',
      contentType: 'audio/wav',
      bytes: REAL_WAV_BYTES,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)

    const config = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(config?.customSlaSoundKey).toBe(`sla-sounds/${org.id}.wav`)
  })

  it('rejeita tipo de arquivo não permitido', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary2'
    const body = buildMultipartBody(boundary, {
      filename: 'virus.exe',
      contentType: 'application/x-msdownload',
      bytes: Buffer.from('bytes'),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(422)
  })

  it('rejeita arquivo que declara Content-Type audio/mpeg mas não tem assinatura de MP3 real', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary-spoof'
    const body = buildMultipartBody(boundary, {
      filename: 'nao-e-mp3.mp3',
      contentType: 'audio/mpeg',
      bytes: Buffer.from('isso aqui nao e um mp3 de verdade'),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(422)
  })
})
