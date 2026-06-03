import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as b2Module from '@/lib/b2'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')
  vi.spyOn(b2Module, 'deleteFile').mockResolvedValue(undefined)
})

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const col = await createTestColumn(board.id, { position: 0 })
  const task = await createTestTask(col.id, user.id)
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { task, user, org, auth }
}

describe('POST /tasks/:id/attachments', () => {
  it('rejects file above 20MB with 413', async () => {
    const { task, auth } = await setup()
    const boundary = 'boundary123'
    const bigContent = 'x'.repeat(21 * 1024 * 1024)
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\nContent-Type: application/pdf\r\n\r\n${bigContent}\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    expect(res.statusCode).toBe(413)
  })

  it('rejects disallowed MIME type with 422', async () => {
    const { task, auth } = await setup()
    const boundary = 'boundary456'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hack.exe"\r\nContent-Type: application/x-msdownload\r\n\r\nMZcontent\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    expect(res.statusCode).toBe(422)
  })

  it('uploads allowed file and returns 201', async () => {
    const { task, auth } = await setup()
    const boundary = 'boundary789'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\nPDF content\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).filename).toBe('doc.pdf')
  })
})

describe('GET /tasks/:id/attachments', () => {
  it('returns attachments list with signed URLs', async () => {
    const { task, auth } = await setup()

    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}/attachments`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})
