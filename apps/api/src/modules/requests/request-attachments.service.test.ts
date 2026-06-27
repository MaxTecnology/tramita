import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestClient } from '@/test/helpers'
import { createRequest } from './requests.service'
import { createRequestAttachment } from './request-attachments.service'
import * as b2 from '@/lib/b2'

beforeEach(() => {
  vi.spyOn(b2, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2, 'getSignedDownloadUrl').mockResolvedValue('https://signed.example/file')
  vi.spyOn(b2, 'deleteFile').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('createRequestAttachment', () => {
  it('faz upload e cria o registro vinculado à request do próprio cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido com anexo' })

    const attachment = await createRequestAttachment(request.id, org.id, client.id, {
      filename: 'documento.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('conteudo'),
    })

    expect(attachment.filename).toBe('documento.pdf')
    expect(attachment.uploadedBy).toBe(client.id)
    expect(b2.uploadFile).toHaveBeenCalledTimes(1)

    const found = await prisma.requestAttachment.findFirst({ where: { requestId: request.id } })
    expect(found?.id).toBe(attachment.id)
  })

  it('lança 404 se a request não pertence ao cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'anexo-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'anexo-b@test.com' })
    const request = await createRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(
      createRequestAttachment(request.id, org.id, clientB.id, {
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
