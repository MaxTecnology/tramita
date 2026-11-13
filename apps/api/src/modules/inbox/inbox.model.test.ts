import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn,
  createTestTask, createTestClientUser,
} from '@/test/helpers'

async function setup() {
  const org = await createTestOrg((await createTestPlan()).id)
  const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
  const { clientUser } = await createTestClientUser(org.id)
  return { org, user, clientUser }
}

const base = (organizationId: string) => ({ organizationId, type: 'TASK_COMMENT' as const, title: 't', body: 'b', link: '/app' })

describe('InAppNotification', () => {
  it('has exactly one recipient', async () => {
    const { org, user, clientUser } = await setup()
    await expect(prisma.inAppNotification.create({ data: base(org.id) })).rejects.toThrow()
    await expect(prisma.inAppNotification.create({ data: { ...base(org.id), recipientUserId: user.id, recipientClientUserId: clientUser.id } })).rejects.toThrow()
    expect((await prisma.inAppNotification.create({ data: { ...base(org.id), recipientUserId: user.id } })).readAt).toBeNull()
  })
})

describe('TaskApproval', () => {
  it('starts pending and its file is unique to it', async () => {
    const { org, user } = await setup()
    const client = await createTestClient(org.id)
    const col = await createTestColumn((await createTestBoard(org.id, client.id)).id)
    const task = await createTestTask(col.id, user.id)
    const file = await prisma.attachment.create({ data: { taskId: task.id, filename: 'previa.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'k', uploadedBy: user.id } })
    const approval = await prisma.taskApproval.create({ data: { taskId: task.id, organizationId: org.id, title: 'Prévia', attachmentId: file.id, requestedById: user.id } })
    expect(approval.status).toBe('PENDING')
    await expect(prisma.taskApproval.create({ data: { taskId: task.id, organizationId: org.id, title: 'Outra', attachmentId: file.id, requestedById: user.id } })).rejects.toMatchObject({ code: 'P2002' })
  })
})
