import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
} from '@/modules/columns/columns.service'
import {
  createTestPlan,
  createTestOrg,
  createTestClient,
  createTestBoard,
  createTestColumn,
} from '@/test/helpers'

describe('createColumn', () => {
  it('creates a column for a board in the same organization', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)

    const result = await createColumn(board.id, org.id, {
      title: 'Nova Coluna', position: 0, isFinal: false,
    })

    expect(result.title).toBe('Nova Coluna')
    expect(result.boardId).toBe(board.id)
  })

  it('throws 404 when board belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)

    await expect(
      createColumn(board.id, orgB.id, { title: 'X', position: 0, isFinal: false }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('updateColumn', () => {
  it('updates title and isFinal', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const result = await updateColumn(col.id, org.id, { title: 'Renomeada', isFinal: true })

    expect(result.title).toBe('Renomeada')
    expect(result.isFinal).toBe(true)
  })

  it('throws 404 when column belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    await expect(updateColumn(col.id, orgB.id, { title: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reorderColumns', () => {
  it('updates position for each column', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const colA = await createTestColumn(board.id, { position: 0 })
    const colB = await createTestColumn(board.id, { position: 1 })

    const result = await reorderColumns(
      [{ id: colA.id, position: 1 }, { id: colB.id, position: 0 }],
      org.id,
    )

    expect(result.ok).toBe(true)
    const updated = await prisma.column.findUnique({ where: { id: colA.id } })
    expect(updated?.position).toBe(1)
  })

  it('throws 403 when any column belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    await expect(
      reorderColumns([{ id: col.id, position: 0 }], orgB.id),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('deleteColumn', () => {
  it('removes the column row', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const result = await deleteColumn(col.id, org.id)

    expect(result.ok).toBe(true)
    const stored = await prisma.column.findUnique({ where: { id: col.id } })
    expect(stored).toBeNull()
  })

  it('throws 404 when column belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const client = await createTestClient(orgA.id)
    const board = await createTestBoard(orgA.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    await expect(deleteColumn(col.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})
