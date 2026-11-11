import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { ClientBody } from './clients.schema'

// Regras de "departamento atendido" (spec 2026-11-11-cobertura-departamentos-cliente-design):
// um departamento atende o cliente quando existe ClientAssignment(cliente, departamento), e o
// userId dele é o responsável do escritório.

export type Db = Prisma.TransactionClient | typeof prisma

const CLOSED_TASK_STATUSES = ['DONE', 'DISREGARDED'] as const

export async function listServedDepartmentIds(db: Db, clientId: string): Promise<string[]> {
  const rows = await db.clientAssignment.findMany({ where: { clientId }, select: { departmentId: true } })
  return rows.map((r) => r.departmentId)
}

export async function assertDepartmentServesClient(db: Db, clientId: string, departmentId: string): Promise<void> {
  const served = await db.clientAssignment.findUnique({
    where: { clientId_departmentId: { clientId, departmentId } },
    select: { id: true },
  })
  if (served) return

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
): void {
  const served = new Set(departments.map((d) => d.departmentId))
  const covered = new Set<string>()

  for (const link of clientUsers) {
    for (const departmentId of link.departmentIds) {
      if (!served.has(departmentId)) {
        throw new AppError(400, `O departamento ${departmentNames.get(departmentId) ?? ''} não atende este cliente.`)
      }
      covered.add(departmentId)
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
