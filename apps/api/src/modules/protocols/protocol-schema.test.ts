import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, user.id)
  const deliverable = await prisma.taskDeliverable.create({
    data: { taskId: task.id, name: 'Guia DAS', position: 0, requiresPayment: true, amount: '1234.56' },
  })
  return { org, user, client, task, deliverable }
}

describe('Protocol payment schema', () => {
  it('persists payment, cancellation and deliverable link on Protocol', async () => {
    const { org, user, client, task, deliverable } = await setup()

    const created = await prisma.protocol.create({
      data: {
        organizationId: org.id, number: '2026-000001', clientId: client.id, taskId: task.id,
        title: 'Guia DAS', createdById: user.id, requiresPayment: true, amount: '1234.56',
        competence: new Date('2026-10-01'), deliverableId: deliverable.id,
      },
    })
    const paid = await prisma.protocol.update({
      where: { id: created.id },
      data: { paidAt: new Date(), paidAmount: '1234.56' },
    })

    expect(paid.amount?.toString()).toBe('1234.56')
    expect(paid.paidAmount?.toString()).toBe('1234.56')
    expect(paid.deliverableId).toBe(deliverable.id)

    await expect(
      prisma.protocol.create({
        data: {
          organizationId: org.id, number: '2026-000002', clientId: client.id, taskId: task.id,
          title: 'Duplicada', createdById: user.id, deliverableId: deliverable.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>)
  })

  it('accepts NOT_APPLICABLE on document requirements', async () => {
    const { task } = await setup()
    const req = await prisma.taskDocumentRequirement.create({
      data: { taskId: task.id, name: 'Extrato', position: 0, status: 'NOT_APPLICABLE' },
    })
    expect(req.status).toBe('NOT_APPLICABLE')
  })
})
