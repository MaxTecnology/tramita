import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateColumnBody, UpdateColumnBody, ReorderColumnsBody } from './columns.schema'

export async function createColumn(boardId: string, organizationId: string, data: CreateColumnBody) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, isActive: true } })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.column.create({ data: { ...data, boardId } })
}

export async function updateColumn(id: string, organizationId: string, data: UpdateColumnBody) {
  const column = await prisma.column.findFirst({
    where: { id, board: { organizationId } },
  })
  if (!column) throw new AppError(404, 'Coluna não encontrada')

  return prisma.column.update({ where: { id }, data })
}

export async function reorderColumns(items: ReorderColumnsBody, organizationId: string) {
  const columns = await prisma.column.findMany({
    where: { id: { in: items.map((i) => i.id) }, board: { organizationId } },
  })
  if (columns.length !== items.length) throw new AppError(403, 'Acesso negado')

  await prisma.$transaction(
    items.map((i) => prisma.column.update({ where: { id: i.id }, data: { position: i.position } })),
  )
  return { ok: true }
}

export async function deleteColumn(id: string, organizationId: string) {
  const column = await prisma.column.findFirst({
    where: { id, board: { organizationId } },
  })
  if (!column) throw new AppError(404, 'Coluna não encontrada')

  await prisma.column.delete({ where: { id } })
  return { ok: true }
}
