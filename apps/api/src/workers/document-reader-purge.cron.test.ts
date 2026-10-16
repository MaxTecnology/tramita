import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { purgeRejectedDocuments } from './document-reader-purge.cron'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'

vi.mock('@/lib/b2', () => ({ deleteFile: vi.fn() }))

describe('purgeRejectedDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expurga REJECTED com mais de 30 dias, apagando do B2 e limpando campos extraídos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const antigo = await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h1', storageKey: 'k1', uploadedById: admin.id,
        status: 'REJECTED', extractedFields: { cnpj: { valor: '11222333000181' } },
        reviewedAt: new Date(Date.UTC(2026, 8, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15))) // 44 dias depois

    expect(count).toBe(1)
    const deleteFileSpy = await import('@/lib/b2')
    expect(deleteFileSpy.deleteFile).toHaveBeenCalledWith('k1')
    const atualizado = await prisma.receivedDocument.findUniqueOrThrow({ where: { id: antigo.id } })
    expect(atualizado.extractedFields).toBeNull()
  })

  it('não expurga REJECTED com menos de 30 dias', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h2', storageKey: 'k2', uploadedById: admin.id,
        status: 'REJECTED', reviewedAt: new Date(Date.UTC(2026, 9, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15))) // 14 dias depois

    expect(count).toBe(0)
  })

  it('rodar o expurgo duas vezes não tenta apagar a mesma linha de novo (idempotente — nunca chama deleteFile com storageKey vazia)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h-dupe', storageKey: 'k-dupe', uploadedById: admin.id,
        status: 'REJECTED', reviewedAt: new Date(Date.UTC(2026, 8, 1)),
      },
    })

    const primeira = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15)))
    const segunda = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15)))

    expect(primeira).toBe(1)
    expect(segunda).toBe(0)
    const deleteFileSpy = await import('@/lib/b2')
    expect(deleteFileSpy.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('não mexe em PENDING/NOT_IDENTIFIED, mesmo antigo — é trabalho em aberto', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.receivedDocument.create({
      data: {
        organizationId: org.id, fileHash: 'h3', storageKey: 'k3', uploadedById: admin.id,
        status: 'PENDING', createdAt: new Date(Date.UTC(2026, 1, 1)),
      },
    })

    const count = await purgeRejectedDocuments(new Date(Date.UTC(2026, 9, 15)))

    expect(count).toBe(0)
  })
})
