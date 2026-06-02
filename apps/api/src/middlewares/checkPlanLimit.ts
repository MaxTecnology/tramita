import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkPlanLimit(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId } = request.user
  if (!organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      plan: true,
      _count: { select: { clients: { where: { isActive: true } } } },
    },
  })

  if (!org) throw new AppError(404, 'Organização não encontrada')

  if (org._count.clients >= org.plan.maxClients) {
    throw new AppError(422, `Limite de clientes atingido (máximo: ${org.plan.maxClients})`)
  }
}
