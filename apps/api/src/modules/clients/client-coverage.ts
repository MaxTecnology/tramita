import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { ClientBody } from './clients.schema'

// Regras de "departamento atendido" (spec 2026-11-11-cobertura-departamentos-cliente-design):
// um departamento atende o cliente quando existe ClientAssignment(cliente, departamento), e o
// userId dele é o responsável do escritório.

export type Db = Prisma.TransactionClient | typeof prisma

const CLOSED_TASK_STATUSES = ['DONE', 'DISREGARDED'] as const

// Row lock on the clients whose coverage a transaction checks and changes. Postgres runs in READ
// COMMITTED: without it two admins editing at the same instant each pass their own check and
// together break the rule. Locks in id order so two transactions never deadlock. Must be the first
// thing the transaction does, before any coverage read.
export async function lockClients(tx: Prisma.TransactionClient, clientIds: string[]): Promise<void> {
  const ids = [...new Set(clientIds)].sort()
  if (ids.length === 0) return
  await tx.$queryRaw`SELECT id FROM clients WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
}

// Shared lock on staff about to become responsible (client form, transfer). deleteUser takes the
// exclusive lock on the same row, so deactivating someone and making them responsible serialize.
export async function lockUsersForShare(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort()
  if (ids.length === 0) return
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`
}

export async function listServedDepartmentIds(db: Db, clientId: string): Promise<string[]> {
  const rows = await db.clientAssignment.findMany({ where: { clientId }, select: { departmentId: true } })
  return rows.map((r) => r.departmentId)
}

// Returns the department's responsible for this client — the default assignee of new tasks.
export async function assertDepartmentServesClient(db: Db, clientId: string, departmentId: string): Promise<string> {
  const served = await db.clientAssignment.findUnique({
    where: { clientId_departmentId: { clientId, departmentId } },
    select: { userId: true },
  })
  if (served) return served.userId

  const [department, client] = await Promise.all([
    db.department.findUnique({ where: { id: departmentId }, select: { name: true } }),
    db.client.findUnique({ where: { id: clientId }, select: { name: true } }),
  ])
  throw new AppError(400, `O departamento ${department?.name ?? ''} não atende o cliente ${client?.name ?? ''}.`)
}

export function assertPayloadCoverage(
  departments: ClientBody['departments'],
  clientUsers: ClientBody['clientUsers'],
  departmentNames: Map<string, string>,
  inactiveUserIds: Set<string> = new Set(),
): void {
  const served = new Set(departments.map((d) => d.departmentId))
  const covered = new Set<string>()

  for (const link of clientUsers) {
    // Usuário existente inativo pode continuar vinculado, mas não cobre departamento (I4 exige ativo).
    const countsForCoverage = !('existingId' in link) || !inactiveUserIds.has(link.existingId)
    for (const departmentId of link.departmentIds) {
      if (!served.has(departmentId)) {
        throw new AppError(400, `O departamento ${departmentNames.get(departmentId) ?? ''} não atende este cliente.`)
      }
      if (countsForCoverage) covered.add(departmentId)
    }
  }

  for (const { departmentId } of departments) {
    if (!covered.has(departmentId)) {
      throw new AppError(
        400,
        `O departamento ${departmentNames.get(departmentId) ?? ''} precisa de pelo menos um usuário do cliente com acesso.`,
      )
    }
  }
}

function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

export async function assertCanUnserveDepartments(db: Db, clientId: string, departmentIds: string[]): Promise<void> {
  for (const departmentId of departmentIds) {
    const [openTasks, recurring, pendingRequests] = await Promise.all([
      db.task.count({
        where: {
          departmentId,
          status: { notIn: [...CLOSED_TASK_STATUSES] },
          column: { board: { clientId } },
        },
      }),
      db.recurringTaskAssignment.count({ where: { clientId, isActive: true, template: { departmentId } } }),
      db.request.count({ where: { clientId, departmentId, status: { in: ['PENDING', 'NEEDS_INFO'] } } }),
    ])

    const parts: string[] = []
    if (openTasks > 0) parts.push(`${openTasks} tarefa(s) aberta(s)`)
    if (recurring > 0) parts.push(`${recurring} tarefa(s) recorrente(s)`)
    if (pendingRequests > 0) parts.push(`${pendingRequests} solicitação(ões) pendente(s)`)
    if (parts.length === 0) continue

    const department = await db.department.findUnique({ where: { id: departmentId }, select: { name: true } })
    throw new AppError(
      409,
      `Não é possível remover o departamento ${department?.name ?? ''}: há ${joinPt(parts)} deste cliente nele.`,
    )
  }
}

type AccessPair = { clientId: string; departmentId: string }

export async function assertAccessesServed(db: Db, accesses: AccessPair[]): Promise<void> {
  // Mesma mensagem de assertDepartmentServesClient, que cita o cliente — a tela de Usuários de
  // Cliente mexe em várias empresas ao mesmo tempo.
  for (const { clientId, departmentId } of accesses) {
    await assertDepartmentServesClient(db, clientId, departmentId)
  }
}

// I4: todo departamento atendido de cliente ativo precisa continuar com pelo menos um usuário do
// cliente ativo. Recusa a mudança que tiraria o último. Clientes desativados não contam.
export async function assertClientUserChangeKeepsCoverage(
  db: Db,
  clientUserId: string,
  next: { accesses: AccessPair[]; isActive: boolean },
): Promise<void> {
  const clientUser = await db.clientUser.findUnique({
    where: { id: clientUserId },
    select: {
      name: true,
      isActive: true,
      accesses: { where: { client: { isActive: true } }, select: { clientId: true, departmentId: true } },
    },
  })
  if (!clientUser || !clientUser.isActive) return

  const kept = new Set(next.isActive ? next.accesses.map((a) => `${a.clientId}:${a.departmentId}`) : [])
  const lost = clientUser.accesses.filter((a) => !kept.has(`${a.clientId}:${a.departmentId}`))

  for (const { clientId, departmentId } of lost) {
    const served = await db.clientAssignment.findUnique({
      where: { clientId_departmentId: { clientId, departmentId } },
      select: { id: true },
    })
    if (!served) continue

    const others = await db.clientUserAccess.count({
      where: { clientId, departmentId, clientUserId: { not: clientUserId }, clientUser: { isActive: true } },
    })
    if (others > 0) continue

    const [department, client] = await Promise.all([
      db.department.findUnique({ where: { id: departmentId }, select: { name: true } }),
      db.client.findUnique({ where: { id: clientId }, select: { name: true } }),
    ])
    throw new AppError(
      409,
      `${clientUser.name} é o único com acesso ao departamento ${department?.name ?? ''} do cliente ${client?.name ?? ''}. Adicione outro usuário antes.`,
    )
  }
}
