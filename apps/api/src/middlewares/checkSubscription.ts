import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkSubscription(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER' || !organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true },
  })

  if (org?.subscriptionStatus === 'SUSPENDED') {
    throw new AppError(403, 'Assinatura suspensa. Regularize o pagamento para continuar.')
  }
}
