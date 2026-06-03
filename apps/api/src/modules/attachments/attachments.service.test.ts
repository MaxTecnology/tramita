import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as b2Module from '@/lib/b2'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import { createAttachment, listAttachments } from '@/modules/attachments/attachments.service'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('attachments.service', () => {
  it('createAttachment saves metadata and returns storageKey containing taskId', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const result = await createAttachment(
      task.id,
      org.id,
      user.id,
      { filename: 'doc.pdf', mimeType: 'application/pdf', size: 1024, buffer: Buffer.from('') },
    )

    expect(result.filename).toBe('doc.pdf')
    expect(result.storageKey).toContain(task.id)
    expect(b2Module.uploadFile).toHaveBeenCalledOnce()
  })

  it('listAttachments returns signed download URLs', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url/file')

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await createAttachment(task.id, org.id, user.id, {
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      buffer: Buffer.from(''),
    })

    const list = await listAttachments(task.id, org.id)
    expect(list).toHaveLength(1)
    expect(list[0].signedUrl).toBe('https://signed-url/file')
  })
})
