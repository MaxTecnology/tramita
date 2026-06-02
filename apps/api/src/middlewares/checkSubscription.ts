import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkSubscription(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER' || !organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true, gracePeriodEndsAt: true },
  })

  if (org?.subscriptionStatus === 'GRACE_PERIOD' && org.gracePeriodEndsAt) {
    if (org.gracePeriodEndsAt < new Date()) {
      // Lazy suspension — auto-suspend on next authenticated request
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'SUSPENDED' },
      })
      throw new AppError(403, 'Grace period expirado. Regularize o pagamento para continuar.')
    }
    return // still within grace period — allow
  }

  if (org?.subscriptionStatus === 'SUSPENDED') {
    throw new AppError(403, 'Assinatura suspensa. Regularize o pagamento para continuar.')
  }
}
