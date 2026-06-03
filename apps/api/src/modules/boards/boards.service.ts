import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateBoardBody, UpdateBoardBody, SearchQuery } from './boards.schema'

export async function listBoards(organizationId: string, clientId?: string) {
  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(clientId ? { clientId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { columns: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getBoardById(id: string, organizationId: string) {
  const board = await prisma.board.findFirst({
    where: { id, organizationId, isActive: true },
    include: {
      client: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
    },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')
  return board
}

export async function createBoard(organizationId: string, data: CreateBoardBody) {
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.board.create({
    data: { title: data.title, description: data.description, clientId: data.clientId, organizationId },
    include: { client: { select: { id: true, name: true } } },
  })
}

export async function updateBoard(id: string, organizationId: string, data: UpdateBoardBody) {
  const board = await prisma.board.findFirst({ where: { id, organizationId, isActive: true } })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.board.update({
    where: { id },
    data,
    include: { client: { select: { id: true, name: true } } },
  })
}

export async function searchTasks(boardId: string, organizationId: string, filters: SearchQuery) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId, isActive: true },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.task.findMany({
    where: {
      column: { boardId },
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.dueBefore ? { dueDate: { lte: new Date(filters.dueBefore) } } : {}),
      ...(filters.dueAfter ? { dueDate: { gte: new Date(filters.dueAfter) } } : {}),
    },
    orderBy: { position: 'asc' },
  })
}
