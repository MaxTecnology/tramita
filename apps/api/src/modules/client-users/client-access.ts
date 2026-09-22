// apps/api/src/modules/client-users/client-access.ts
import { prisma } from '@/lib/prisma'

export interface ClientAccessScope {
  clientIds: string[]
  departmentIdsByClient: Map<string, Set<string>>
}

export async function getClientAccessScope(clientUserId: string): Promise<ClientAccessScope> {
  const accesses = await prisma.clientUserAccess.findMany({
    where: { clientUserId, clientUser: { isActive: true } },
    select: { clientId: true, departmentId: true },
    orderBy: { clientId: 'asc' },
  })

  const departmentIdsByClient = new Map<string, Set<string>>()
  for (const a of accesses) {
    if (!departmentIdsByClient.has(a.clientId)) departmentIdsByClient.set(a.clientId, new Set())
    departmentIdsByClient.get(a.clientId)!.add(a.departmentId)
  }

  return { clientIds: [...departmentIdsByClient.keys()], departmentIdsByClient }
}

export function canSeeTask(scope: ClientAccessScope, clientId: string, departmentId: string): boolean {
  return scope.departmentIdsByClient.get(clientId)?.has(departmentId) ?? false
}
