import type { FastifyRequest } from 'fastify'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { memberBoardWhere } from '@/modules/boards/board-visibility'

// What an office user can see (spec 2026-11-12-visibilidade-por-departamento):
// - ORG_ADMIN: the whole organization.
// - ORG_MANAGER: everything of the clients served by their departments.
// - ORG_MEMBER: their portfolio + (when seesDepartmentWork) the same as a manager of their departments.
export type StaffScope =
  | { kind: 'ALL' }
  | {
      kind: 'LIMITED'
      role: 'ORG_MANAGER' | 'ORG_MEMBER'
      userId: string
      organizationId: string
      departmentIds: string[]
      seesDepartment: boolean
      // (client, department) pairs this user is responsible for (ClientAssignment)
      assignments: { clientId: string; departmentId: string }[]
    }

type ScopeUser = { sub: string; role: string; organizationId: string | null }
type Limited = Extract<StaffScope, { kind: 'LIMITED' }>

export async function loadStaffScope(user: ScopeUser): Promise<StaffScope> {
  if (user.role === 'ORG_ADMIN') return { kind: 'ALL' }
  if (user.role !== 'ORG_MANAGER' && user.role !== 'ORG_MEMBER') throw new AppError(403, 'Acesso negado')

  const row = await prisma.user.findUnique({
    where: { id: user.sub },
    select: {
      seesDepartmentWork: true,
      departments: { select: { departmentId: true } },
      clientAssignments: { select: { clientId: true, departmentId: true } },
    },
  })
  return {
    kind: 'LIMITED',
    role: user.role,
    userId: user.sub,
    organizationId: user.organizationId ?? '',
    departmentIds: row?.departments.map((d) => d.departmentId) ?? [],
    seesDepartment: user.role === 'ORG_MANAGER' ? true : (row?.seesDepartmentWork ?? false),
    assignments: row?.clientAssignments ?? [],
  }
}

// Services that receive an actor instead of the request
export function actorScope(actor: { id: string; role: string }, organizationId: string): Promise<StaffScope> {
  return loadStaffScope({ sub: actor.id, role: actor.role, organizationId })
}

// One database read per request, shared by every check of that request.
const perRequest = new WeakMap<FastifyRequest, Promise<StaffScope>>()
export function getStaffScope(request: FastifyRequest): Promise<StaffScope> {
  let scope = perRequest.get(request)
  if (!scope) {
    scope = loadStaffScope(request.user)
    perRequest.set(request, scope)
  }
  return scope
}

// Department reach applies only with the option on and at least one department — never `in: []`
// turning into "everything", never an empty IN.
function departmentReach(scope: Limited): string[] | null {
  return scope.seesDepartment && scope.departmentIds.length > 0 ? scope.departmentIds : null
}

export function boardWhere(scope: StaffScope): Prisma.BoardWhereInput {
  if (scope.kind === 'ALL') return {}
  const reach = departmentReach(scope)
  return {
    OR: [
      memberBoardWhere(scope.userId),
      ...(reach ? [{ client: { clientAssignments: { some: { departmentId: { in: reach } } } } }] : []),
    ],
  }
}

export function taskWhere(scope: StaffScope): Prisma.TaskWhereInput {
  if (scope.kind === 'ALL') return {}
  const reach = departmentReach(scope)
  return {
    OR: [
      { assigneeId: scope.userId },
      { column: { board: { type: 'OS', ...boardWhere(scope) } } },
      ...(reach ? [{ departmentId: { in: reach } }] : []),
    ],
  }
}

export function mineTaskWhere(userId: string): Prisma.TaskWhereInput {
  return { assigneeId: userId }
}

export function mineRequestWhere(scope: StaffScope): Prisma.RequestWhereInput {
  if (scope.kind === 'ALL') return {}
  return { OR: scope.assignments.map((a) => ({ clientId: a.clientId, departmentId: a.departmentId })) }
}

export function requestWhere(scope: StaffScope): Prisma.RequestWhereInput {
  if (scope.kind === 'ALL') return {}
  const reach = departmentReach(scope)
  return {
    OR: [
      ...scope.assignments.map((a) => ({ clientId: a.clientId, departmentId: a.departmentId })),
      ...(reach ? [{ departmentId: { in: reach } }] : []),
    ],
  }
}

export function canSeeUnidentifiedDocuments(scope: StaffScope): boolean {
  return scope.kind === 'ALL' || scope.role === 'ORG_MANAGER'
}

export function receivedDocumentWhere(scope: StaffScope): Prisma.ReceivedDocumentWhereInput {
  if (scope.kind === 'ALL') return {}
  return {
    OR: [
      { task: taskWhere(scope) },
      ...(canSeeUnidentifiedDocuments(scope) ? [{ taskId: null }] : []),
    ],
  }
}

export function protocolWhere(scope: StaffScope): Prisma.ProtocolWhereInput {
  if (scope.kind === 'ALL') return {}
  return { task: taskWhere(scope) }
}

// Write gate. A member changes only their own tasks or tasks of a process in their portfolio; a
// colleague's task seen through the department must be assumed first. Managers act on what they see.
export function actableTaskWhere(scope: StaffScope): Prisma.TaskWhereInput {
  if (scope.kind === 'ALL') return {}
  if (scope.role === 'ORG_MANAGER') return taskWhere(scope)
  return {
    OR: [
      { assigneeId: scope.userId },
      { column: { board: { type: 'OS', ...memberBoardWhere(scope.userId) } } },
    ],
  }
}

export async function canActOnTask(scope: StaffScope, task: { id: string }): Promise<boolean> {
  if (scope.kind === 'ALL') return true
  return (await prisma.task.count({ where: { id: task.id, AND: [actableTaskWhere(scope)] } })) > 0
}

export async function userBelongsToDepartment(userId: string, departmentId: string): Promise<boolean> {
  return (await prisma.userDepartment.count({ where: { userId, departmentId } })) > 0
}
