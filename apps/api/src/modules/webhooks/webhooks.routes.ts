import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

interface AsaasPayload {
  event: 'PAYMENT_CONFIRMED' | 'PAYMENT_OVERDUE' | 'PAYMENT_DELETED'
  payment: {
    id: string
    subscription: string
    customer: string
    value: number
  }
}

export async function webhooksRoutes(app: FastifyInstance) {
  app.post('/asaas', async (request, reply) => {
    const { accessToken } = request.query as { accessToken?: string }
    if (!accessToken || accessToken !== process.env.ASAAS_WEBHOOK_SECRET) {
      throw new AppError(401, 'Webhook token inválido')
    }

    const { event, payment } = request.body as AsaasPayload
    if (!payment?.subscription) return reply.send({ received: true })

    const org = await prisma.organization.findFirst({
      where: { asaasSubscriptionId: payment.subscription },
    })
    if (!org) return reply.send({ received: true })

    if (event === 'PAYMENT_CONFIRMED') {
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null },
      })
      await prisma.subscriptionHistory.create({
        data: {
          organizationId: org.id,
          event: 'PAYMENT_CONFIRMED',
          amount: payment.value,
          asaasPaymentId: payment.id,
        },
      })
    } else if (event === 'PAYMENT_OVERDUE') {
      const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'GRACE_PERIOD', gracePeriodEndsAt },
      })
      await prisma.subscriptionHistory.create({
        data: { organizationId: org.id, event: 'PAYMENT_OVERDUE', asaasPaymentId: payment.id },
      })
    } else if (event === 'PAYMENT_DELETED') {
      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: 'SUSPENDED' },
      })
      await prisma.subscriptionHistory.create({
        data: { organizationId: org.id, event: 'PAYMENT_DELETED', asaasPaymentId: payment.id },
      })
    }

    return reply.send({ received: true })
  })
}
