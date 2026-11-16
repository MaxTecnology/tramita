import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestClient, createTestRequest } from '@/test/helpers'
import { cancelRequest, getRequestById, listRequestsForOrg, listRequestsForClient } from './requests.service'
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
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido com anexo' })

    const attachment = await createRequestAttachment(request.id, org.id, client.id, {
      filename: 'documento.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('conteudo'),
    })

    expect(attachment.filename).toBe('documento.pdf')
    expect(attachment.uploadedBy).toBe(client.id)
    expect(attachment).toMatchObject({ url: 'https://signed.example/file' })
    expect(attachment).not.toHaveProperty('storageKey')
    expect(b2.uploadFile).toHaveBeenCalledTimes(1)

    const found = await prisma.requestAttachment.findFirst({ where: { requestId: request.id } })
    expect(found?.id).toBe(attachment.id)
  })

  it('lança 404 se a request não pertence ao cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { name: 'anexo-a@test.com' })
    const clientB = await createTestClient(org.id, { name: 'anexo-b@test.com' })
    const request = await createTestRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(
      createRequestAttachment(request.id, org.id, clientB.id, {
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 422 se a request não está mais PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Pedido cancelado' })
    await cancelRequest(request.id, org.id, client.id)

    await expect(
      createRequestAttachment(request.id, org.id, client.id, {
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
    expect(b2.uploadFile).not.toHaveBeenCalled()
  })
})

describe('anexos da solicitação: quando aceita e como aparecem', () => {
  const file = { filename: 'contrato.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from('x') }

  it('accepts a file while the office asked for more information (that is when the client sends it)', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Abrir empresa' })
    await prisma.request.update({ where: { id: request.id }, data: { status: 'NEEDS_INFO' } })

    const attachment = await createRequestAttachment(request.id, org.id, client.id, file)
    expect(attachment.filename).toBe('contrato.pdf')
  })

  it('detail and lists bring each file with a temporary download link and never the storage key', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const client = await createTestClient(org.id)
    const request = await createTestRequest(org.id, client.id, { title: 'Abrir empresa' })
    await createRequestAttachment(request.id, org.id, client.id, file)

    const detail = await getRequestById(request.id, org.id)
    const [fromOrg] = await listRequestsForOrg(org.id)
    const [fromClient] = await listRequestsForClient(org.id, client.id)
    for (const r of [detail, fromOrg, fromClient]) {
      expect(r.attachments).toEqual([expect.objectContaining({ filename: 'contrato.pdf', size: 10, url: 'https://signed.example/file' })])
      expect(JSON.stringify(r.attachments)).not.toContain('storageKey')
    }
  })
})
