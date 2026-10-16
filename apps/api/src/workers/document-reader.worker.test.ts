import { describe, it, expect, vi } from 'vitest'
import { processDocumentReaderJob, handleJobFailed } from './document-reader.worker'
import * as service from '@/modules/document-reader/document-reader.service'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

describe('processDocumentReaderJob', () => {
  it('chama processarDocumento com o id do job', async () => {
    const spy = vi.spyOn(service, 'processarDocumento').mockResolvedValue()
    await processDocumentReaderJob({ data: { receivedDocumentId: 'doc-1' } })
    expect(spy).toHaveBeenCalledWith('doc-1')
  })

  it('erro ao processar não trava o job pra sempre — propaga pro retry do BullMQ (attempts: 3 já configurado na fila)', async () => {
    vi.spyOn(service, 'processarDocumento').mockRejectedValue(new Error('PDF corrompido'))
    await expect(processDocumentReaderJob({ data: { receivedDocumentId: 'doc-2' } })).rejects.toThrow('PDF corrompido')
  })
})

describe('handleJobFailed', () => {
  async function criarDocPending() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    return prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'h-falha', storageKey: 'k-falha', uploadedById: admin.id, status: 'PENDING' },
    })
  }

  it('marca NOT_IDENTIFIED com o motivo quando as tentativas se esgotaram — não fica preso em PENDING pra sempre', async () => {
    const doc = await criarDocPending()

    await handleJobFailed({ attemptsMade: 3, opts: { attempts: 3 }, data: { receivedDocumentId: doc.id } }, new Error('B2 fora do ar'))

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('NOT_IDENTIFIED')
    expect((atualizado.extractedFields as any)._erro).toBe('B2 fora do ar')
  })

  it('não mexe no documento quando ainda há tentativas restantes — o BullMQ vai tentar de novo', async () => {
    const doc = await criarDocPending()

    await handleJobFailed({ attemptsMade: 1, opts: { attempts: 3 }, data: { receivedDocumentId: doc.id } }, new Error('timeout transiente'))

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('PENDING')
  })

  it('não sobrescreve um documento que um humano já decidiu enquanto o job falhava', async () => {
    const doc = await criarDocPending()
    await prisma.receivedDocument.update({ where: { id: doc.id }, data: { status: 'ATTACHED' } })

    await handleJobFailed({ attemptsMade: 3, opts: { attempts: 3 }, data: { receivedDocumentId: doc.id } }, new Error('tarde demais'))

    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(atualizado.status).toBe('ATTACHED')
  })
})
