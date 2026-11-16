import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'

export async function getTaskHistory(taskId: string, organizationId: string, clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId, isActive: true, clientId: { in: scope.clientIds } } } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task || !task.visibleToClient || !canSeeTask(scope, task.column.board.clientId, task.departmentId)) {
    throw new AppError(404, 'Tarefa não encontrada')
  }

  return prisma.taskHistory.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } })
}

export async function listAccessibleClients(clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  if (scope.clientIds.length === 0) return []
  return prisma.client.findMany({
    where: { id: { in: scope.clientIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

// Catalog of "Solicitar serviço": active standalone OS models and requestable processes whose
// department this client user reaches in the company. A process asks for the competence when any
// of its OS does.
export async function listRequestableServices(organizationId: string, clientUserId: string, clientId: string) {
  const accesses = await prisma.clientUserAccess.findMany({ where: { clientUserId, clientId }, select: { departmentId: true } })
  const departmentIds = accesses.map((a) => a.departmentId)
  const [models, templates] = await Promise.all([
    prisma.oSModel.findMany({
      where: { organizationId, isActive: true, usableStandalone: true, departmentId: { in: departmentIds } },
      select: { id: true, name: true, description: true, departmentId: true, requiresCompetence: true },
    }),
    prisma.processTemplate.findMany({
      where: { organizationId, isActive: true, clientCanRequest: true, departmentId: { in: departmentIds } },
      select: { id: true, name: true, description: true, departmentId: true, items: { select: { osModel: { select: { requiresCompetence: true } } } } },
    }),
  ])
  return [
    ...models.map((m) => ({ kind: 'OS' as const, id: m.id, name: m.name, description: m.description, departmentId: m.departmentId, requiresCompetence: m.requiresCompetence })),
    ...templates.map((t) => ({
      kind: 'PROCESS' as const, id: t.id, name: t.name, description: t.description, departmentId: t.departmentId!,
      requiresCompetence: t.items.some((i) => i.osModel.requiresCompetence),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
