import type { FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import {
  getStaffScope, boardWhere, taskWhere, protocolWhere, actableTaskWhere, memberPortfolioBoardWhere, type StaffScope,
} from '@/modules/staff-scope/staff-scope'

export interface ScopeTargets {
  boardIds?: string[]
  columnIds?: string[]
  taskIds?: string[]
  protocolIds?: string[]
}

// read = see (GETs, search, SSE, comments); write = change anything else.
export type ScopeMode = 'read' | 'write'

export const MUST_ASSUME = 'Assuma a tarefa para alterá-la'

const uniq = (ids: (string | undefined)[] = []) => [...new Set(ids.filter((id): id is string => typeof id === 'string'))]

// Boards a user may change: a manager what they see; a member only their portfolio processes.
function actableBoardWhere(scope: StaffScope): Prisma.BoardWhereInput {
  if (scope.kind === 'ALL' || scope.role === 'ORG_MANAGER') return boardWhere(scope)
  return memberPortfolioBoardWhere(scope.userId)
}

// Ids that do not exist in the organization are left for the service (its usual 404). Ids that
// exist but are out of reach answer 404 (existence never revealed); visible but not changeable
// answers 403 MUST_ASSUME.
async function check(
  total: () => Promise<number>,
  visible: () => Promise<number>,
  actable: (() => Promise<number>) | null,
): Promise<void> {
  const all = await total()
  if (all === 0) return
  if ((await visible()) < all) throw new AppError(404, 'Processo não encontrado')
  if (actable && (await actable()) < all) throw new AppError(403, MUST_ASSUME)
}

export async function assertStaffSees(scope: StaffScope, organizationId: string, targets: ScopeTargets, mode: ScopeMode): Promise<void> {
  if (scope.kind === 'ALL') return
  const write = mode === 'write'

  const boardIds = uniq(targets.boardIds)
  if (boardIds.length) {
    const base = { id: { in: boardIds }, organizationId }
    await check(
      () => prisma.board.count({ where: base }),
      () => prisma.board.count({ where: { ...base, AND: [boardWhere(scope)] } }),
      write ? () => prisma.board.count({ where: { ...base, AND: [actableBoardWhere(scope)] } }) : null,
    )
  }

  const columnIds = uniq(targets.columnIds)
  if (columnIds.length) {
    const base = { id: { in: columnIds } }
    await check(
      () => prisma.column.count({ where: { ...base, board: { organizationId } } }),
      () => prisma.column.count({ where: { ...base, board: { organizationId, AND: [boardWhere(scope)] } } }),
      write ? () => prisma.column.count({ where: { ...base, board: { organizationId, AND: [actableBoardWhere(scope)] } } }) : null,
    )
  }

  const taskIds = uniq(targets.taskIds)
  if (taskIds.length) {
    const base = { id: { in: taskIds }, column: { board: { organizationId } } }
    await check(
      () => prisma.task.count({ where: base }),
      () => prisma.task.count({ where: { ...base, AND: [taskWhere(scope)] } }),
      write ? () => prisma.task.count({ where: { ...base, AND: [actableTaskWhere(scope)] } }) : null,
    )
  }

  const protocolIds = uniq(targets.protocolIds)
  if (protocolIds.length) {
    const base = { id: { in: protocolIds }, organizationId }
    await check(
      () => prisma.protocol.count({ where: base }),
      () => prisma.protocol.count({ where: { ...base, AND: [protocolWhere(scope)] } }),
      write ? () => prisma.protocol.count({ where: { ...base, task: actableTaskWhere(scope) } }) : null,
    )
  }
}

// preHandler factory (after verifyJWT). The body is untrusted here (Zod runs later in the handler),
// so resolvers read it defensively through `bodyIds`. `mode` may depend on the request (hooks shared
// by GET and POST routes).
export function staffScope(resolve: (request: FastifyRequest) => ScopeTargets, mode: ScopeMode | ((request: FastifyRequest) => ScopeMode)) {
  return async (request: FastifyRequest) => {
    const role = request.user?.role
    if (role !== 'ORG_MEMBER' && role !== 'ORG_MANAGER') return
    const targets = resolve(request)
    if (!Object.values(targets).some((ids) => ids?.length)) return
    const scope = await getStaffScope(request)
    await assertStaffSees(scope, request.user.organizationId ?? '', targets, typeof mode === 'function' ? mode(request) : mode)
  }
}

// Hooks shared by every method of a module: GET reads, anything else writes.
export const byMethod = (request: FastifyRequest): ScopeMode => (request.method === 'GET' ? 'read' : 'write')

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
