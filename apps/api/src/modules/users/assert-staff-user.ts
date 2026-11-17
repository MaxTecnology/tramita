import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'

// Whoever is given a task, an OS or a process: an active member of the same office's team. An id of
// another office (or of someone deactivated) is "not found" — never assigned, never notified.
export async function assertActiveStaffUser(organizationId: string, userId: string | null | undefined): Promise<void> {
  if (!userId) return
  const found = await prisma.user.count({
    where: { id: userId, organizationId, isActive: true, role: { in: ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] } },
  })
  if (!found) throw new AppError(404, 'Usuário não encontrado')
}
