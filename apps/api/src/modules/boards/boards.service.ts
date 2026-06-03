import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateBoardBody, UpdateBoardBody, SearchQuery } from './boards.schema'

const DEFAULT_COLUMNS = [
  { title: 'Pendente', position: 0, color: '#6B7280', isFinal: false },
  { title: 'Em andamento', position: 1, color: '#3B82F6', isFinal: false },
  { title: 'Concluído', position: 2, color: '#10B981', isFinal: true },
]

export async function listBoards(
  organizationId: string,
  clientId?: string,
  responsibleUserId?: string,
) {
  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(clientId ? { clientId } : {}),
      ...(responsibleUserId ? { responsibleUserId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
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

export async function createBoard(
  organizationId: string,
  userId: string,
  userRole: string,
  data: CreateBoardBody,
) {
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const responsibleUserId =
    userRole === 'ORG_MEMBER' ? userId : (data.responsibleUserId ?? null)

  return prisma.board.create({
    data: {
      title: data.title,
      description: data.description,
      clientId: data.clientId,
      organizationId,
      responsibleUserId,
      columns: { create: DEFAULT_COLUMNS },
    },
    include: {
      client: { select: { id: true, name: true } },
      columns: { orderBy: { position: 'asc' } },
    },
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
