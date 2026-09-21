import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as b2Module from '@/lib/b2'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  createTestDepartment,
  createTestClientUser,
  grantClientAccess,
} from '@/test/helpers'
import { createAttachment, listAttachments, deleteAttachment } from '@/modules/attachments/attachments.service'

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
      { id: user.id, role: 'ORG_ADMIN' },
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

    await createAttachment(task.id, org.id, { id: user.id, role: 'ORG_ADMIN' }, {
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      buffer: Buffer.from(''),
    })

    const list = await listAttachments(task.id, org.id)
    expect(list).toHaveLength(1)
    expect(list[0].signedUrl).toBe('https://signed-url/file')
  })

  it('listAttachments lança 404 pro cliente quando a tarefa não é visível', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(listAttachments(task.id, org.id, clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    // do lado do escritório (sem clientUserId) continua acessível
    await expect(listAttachments(task.id, org.id)).resolves.toBeDefined()
  })

  it('createAttachment lança 404 quando o cliente tenta anexar em tarefa não-visível', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(
      createAttachment(task.id, org.id, { id: clientUser.id, role: 'CLIENT' }, {
        filename: 'x.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from(''),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('createAttachment grava uploadedByClient com o id da empresa (Client), não do ClientUser', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })

    const attachment = await createAttachment(task.id, org.id, { id: clientUser.id, role: 'CLIENT' }, {
      filename: 'nota.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from(''),
    })

    expect(attachment.uploadedByClient).toBe(client.id)
  })

  it('cliente com acesso a clientA+deptFiscal recebe 404 ao acessar tarefa de clientA marcada deptPessoal', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const clientA = await createTestClient(org.id, { name: 'Cliente A' })
    const deptFiscal = await createTestDepartment(org.id, { name: `Fiscal ${Date.now()}` })
    const deptPessoal = await createTestDepartment(org.id, { name: `Pessoal ${Date.now()}` })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, clientA.id, deptFiscal.id)
    const board = await createTestBoard(org.id, clientA.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: deptPessoal.id })

    await expect(listAttachments(task.id, org.id, clientUser.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      createAttachment(task.id, org.id, { id: clientUser.id, role: 'CLIENT' }, {
        filename: 'x.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from(''),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('deleteAttachment: qualquer ClientUser com acesso à empresa pode remover anexo enviado por outro ClientUser', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'deleteFile').mockResolvedValue(undefined)

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const { clientUser: uploader } = await createTestClientUser(org.id, { email: `up-${Date.now()}@test.com` })
    const { clientUser: otherClientUser } = await createTestClientUser(org.id, { email: `other-${Date.now()}@test.com` })
    await grantClientAccess(uploader.id, client.id, department.id)
    await grantClientAccess(otherClientUser.id, client.id, department.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id, { departmentId: department.id })

    const attachment = await createAttachment(task.id, org.id, { id: uploader.id, role: 'CLIENT' }, {
      filename: 'nota.pdf', mimeType: 'application/pdf', size: 10, buffer: Buffer.from(''),
    })

    await expect(
      deleteAttachment(attachment.id, task.id, org.id, { id: otherClientUser.id, role: 'CLIENT' }),
    ).resolves.toEqual({ ok: true })
  })
})
