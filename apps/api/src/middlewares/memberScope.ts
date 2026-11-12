import type { FastifyRequest } from 'fastify'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { memberBoardWhere } from '@/modules/boards/board-visibility'

export interface ScopeTargets {
  boardIds?: string[]
  columnIds?: string[]
  taskIds?: string[]
  protocolIds?: string[]
}

interface ScopeUser {
  sub: string
  role: string
  organizationId?: string | null
}

const uniq = (ids: (string | undefined)[] = []) => [...new Set(ids.filter((id): id is string => typeof id === 'string'))]

// An ORG_MEMBER may only act on processes they can see (memberBoardWhere). Ids that do not exist in
// the organization are left for the service to answer 404 as usual; ids that exist but belong to a
// process out of the member's scope answer the same 404, so their existence is never revealed.
export async function assertMemberSeesTargets(user: ScopeUser, targets: ScopeTargets): Promise<void> {
  if (user.role !== 'ORG_MEMBER') return
  const organizationId = user.organizationId ?? ''
  const visible = memberBoardWhere(user.sub)
  const notFound = () => new AppError(404, 'Processo não encontrado')

  const boardIds = uniq(targets.boardIds)
  if (boardIds.length) {
    const where = { id: { in: boardIds }, organizationId }
    const [all, seen] = await Promise.all([prisma.board.count({ where }), prisma.board.count({ where: { ...where, AND: [visible] } })])
    if (seen < all) throw notFound()
  }

  const columnIds = uniq(targets.columnIds)
  if (columnIds.length) {
    const [all, seen] = await Promise.all([
      prisma.column.count({ where: { id: { in: columnIds }, board: { organizationId } } }),
      prisma.column.count({ where: { id: { in: columnIds }, board: { organizationId, AND: [visible] } } }),
    ])
    if (seen < all) throw notFound()
  }

  const taskIds = uniq(targets.taskIds)
  if (taskIds.length) {
    const [all, seen] = await Promise.all([
      prisma.task.count({ where: { id: { in: taskIds }, column: { board: { organizationId } } } }),
      prisma.task.count({ where: { id: { in: taskIds }, column: { board: { organizationId, AND: [visible] } } } }),
    ])
    if (seen < all) throw notFound()
  }

  const protocolIds = uniq(targets.protocolIds)
  if (protocolIds.length) {
    const [all, seen] = await Promise.all([
      prisma.protocol.count({ where: { id: { in: protocolIds }, organizationId } }),
      prisma.protocol.count({ where: { id: { in: protocolIds }, organizationId, task: { column: { board: visible } } } }),
    ])
    if (seen < all) throw notFound()
  }
}

// preHandler factory: `resolve` reads the ids the route acts on from params/body. Must run after
// verifyJWT. The body is untrusted here (Zod runs later in the handler), so resolvers read it
// defensively through `bodyIds`.
export function memberScope(resolve: (request: FastifyRequest) => ScopeTargets) {
  return async (request: FastifyRequest) => {
    if (request.user?.role !== 'ORG_MEMBER') return
    await assertMemberSeesTargets(request.user, resolve(request))
  }
}

export function bodyIds(body: unknown, key: string): string[] {
  const items = Array.isArray(body) ? body : [body]
  return items
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined))
    .filter((v): v is string => typeof v === 'string')
}

export const param = (request: FastifyRequest, key: string): string[] => {
  const value = (request.params as Record<string, unknown>)[key]
  return typeof value === 'string' ? [value] : []
}
