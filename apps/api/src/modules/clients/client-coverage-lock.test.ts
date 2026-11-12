import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import { createTask } from '@/modules/tasks/tasks.service'
import { deleteClientUser } from '@/modules/client-users/client-users.service'
import { deleteUser } from '@/modules/users/users.service'
import { lockClients, lockUsersForShare } from './client-coverage'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  serveClientDepartment, createTestBoard, createTestColumn, createTestClientUser, grantClientAccess,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

// Another admin's edit, mid-flight: takes the client lock, makes an uncommitted coverage change and
// waits for `release` before committing. The concurrent operation runs inside that window.
function holdEdit(clientId: string, change: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let locked!: () => void
  const lockTaken = new Promise<void>((r) => { locked = r })
  const done = prisma.$transaction(async (tx) => {
    await lockClients(tx, [clientId])
    await change(tx)
    locked()
    await gate
  }, { timeout: 10_000 })
  return { lockTaken, release, done }
}

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
  const fiscal = await createTestDepartment(org.id, { name: 'Fiscal' })
  const client = await createTestClient(org.id)
  await serveClientDepartment(client.id, fiscal.id, admin.id)
  const board = await createTestBoard(org.id, client.id)
  const column = await createTestColumn(board.id)
  return { org, admin, fiscal, client, column }
}

describe('cobertura de departamentos com dois administradores ao mesmo tempo', () => {
  it('a task created while another admin unserves the department waits and is refused', async () => {
    const { org, admin, fiscal, client, column } = await setup()
    const edit = holdEdit(client.id, (tx) => tx.clientAssignment.deleteMany({ where: { clientId: client.id, departmentId: fiscal.id } }))
    await edit.lockTaken

    const creating = createTask(column.id, org.id, { title: 'Apuração', departmentId: fiscal.id, priority: 'MEDIUM', tags: [] }, { id: admin.id, type: 'user' })
    await new Promise((r) => setTimeout(r, 150))
    edit.release()
    await edit.done

    await expect(creating).rejects.toMatchObject({ statusCode: 400 })
    expect(await prisma.task.count({ where: { departmentId: fiscal.id } })).toBe(0)
  })

  it('deactivating the last two client users of a department at once leaves one of them active', async () => {
    const { org, fiscal, client } = await setup()
    const { clientUser: a } = await createTestClientUser(org.id)
    const { clientUser: b } = await createTestClientUser(org.id)
    await grantClientAccess(a.id, client.id, fiscal.id)
    await grantClientAccess(b.id, client.id, fiscal.id)
    const edit = holdEdit(client.id, (tx) => tx.clientUser.update({ where: { id: a.id }, data: { isActive: false } }))
    await edit.lockTaken

    const deactivatingB = deleteClientUser(b.id, org.id)
    await new Promise((r) => setTimeout(r, 150))
    edit.release()
    await edit.done

    await expect(deactivatingB).rejects.toMatchObject({ statusCode: 409 })
    expect((await prisma.clientUser.findUniqueOrThrow({ where: { id: b.id } })).isActive).toBe(true)
  })

  it('deactivating a staff member while another admin makes them responsible waits and is refused', async () => {
    const { org, client } = await setup()
    const folha = await createTestDepartment(org.id, { name: 'Folha' })
    const bruna = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let locked!: () => void
    const lockTaken = new Promise<void>((r) => { locked = r })
    // The client form / transfer screen, mid-flight: Bruna becomes the Folha responsible
    const edit = prisma.$transaction(async (tx) => {
      await lockUsersForShare(tx, [bruna.id])
      await tx.clientAssignment.create({ data: { clientId: client.id, departmentId: folha.id, userId: bruna.id } })
      locked()
      await gate
    }, { timeout: 10_000 })
    await lockTaken

    const deactivating = deleteUser(bruna.id, org.id)
    await new Promise((r) => setTimeout(r, 150))
    release()
    await edit

    await expect(deactivating).rejects.toMatchObject({ statusCode: 409 })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bruna.id } })).isActive).toBe(true)
  })
})
