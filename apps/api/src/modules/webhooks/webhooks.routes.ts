import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'
import { createHash, timingSafeEqual } from 'node:crypto'

// Constant-time comparison (hashes first so different lengths never short-circuit)
function secretMatches(received: string | undefined): boolean {
  const expected = process.env.ASAAS_WEBHOOK_SECRET
  if (!received || !expected) return false
  const digest = (v: string) => createHash('sha256').update(v).digest()
  return timingSafeEqual(digest(received), digest(expected))
}

// What we use of an Asaas payment event; other events are acknowledged and ignored
const asaasPayloadSchema = z.object({
  event: z.string().min(1),
  payment: z.object({
    id: z.string().min(1),
    subscription: z.string().min(1).nullish(),
    customer: z.string().optional(),
    value: z.number().optional(),
  }).optional(),
  // Subscription events (SUBSCRIPTION_DELETED) carry the subscription instead of a payment
  subscription: z.object({ id: z.string().min(1) }).optional(),
})
const HANDLED = ['PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_DELETED'] as const
type HandledEvent = (typeof HANDLED)[number]

export async function webhooksRoutes(app: FastifyInstance) {
  app.post('/asaas', async (request, reply) => {
    // Only the asaas-access-token header (the token set in the Asaas panel): a token in the URL would
    // end up in proxy logs
    const header = request.headers['asaas-access-token']
    if (!secretMatches(typeof header === 'string' ? header : undefined)) {
      throw new AppError(401, 'Webhook token inválido')
    }

    const parsed = asaasPayloadSchema.safeParse(request.body)
    if (!parsed.success) throw new AppError(400, 'Payload do webhook inválido')
    const { event, payment, subscription } = parsed.data

    // The subscription itself was deleted in Asaas: the office is cancelled (the Master reactivates).
    // A resent event finds it already cancelled and records nothing again.
    if (event === 'SUBSCRIPTION_DELETED' && subscription) {
      const org = await prisma.organization.findFirst({ where: { asaasSubscriptionId: subscription.id, billingMode: 'ASAAS' } })
      if (org && org.subscriptionStatus !== 'CANCELLED') {
        await prisma.$transaction([
          prisma.organization.update({ where: { id: org.id }, data: { subscriptionStatus: 'CANCELLED' } }),
          prisma.subscriptionHistory.create({ data: { organizationId: org.id, event } }),
        ])
      }
      return reply.send({ received: true })
    }

    if (!payment?.subscription || !(HANDLED as readonly string[]).includes(event)) return reply.send({ received: true })

    const org = await prisma.organization.findFirst({
      // A direct-agreement office is controlled by the Master, never by an Asaas event
      where: { asaasSubscriptionId: payment.subscription, billingMode: 'ASAAS' },
    })
    if (!org) return reply.send({ received: true })

    // A late "overdue" of a payment already confirmed (events out of order) changes nothing
    if (event === 'PAYMENT_OVERDUE') {
      const confirmed = await prisma.subscriptionHistory.count({ where: { asaasPaymentId: payment.id, event: 'PAYMENT_CONFIRMED' } })
      if (confirmed > 0) return reply.send({ received: true })
    }

    try {
      await prisma.$transaction(async (tx) => {
        // History first: a resent event hits the unique (payment, event) and nothing is applied twice
        await tx.subscriptionHistory.create({
          data: { organizationId: org.id, event, asaasPaymentId: payment.id, ...(event === 'PAYMENT_CONFIRMED' ? { amount: payment.value } : {}) },
        })
        const status = statusFor(event as HandledEvent)
        if (status) await tx.organization.update({ where: { id: org.id }, data: status })
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return reply.send({ received: true })
      throw err
    }

    return reply.send({ received: true })
  })
}

// A deleted charge (a boleto removed or renegotiated) is only recorded: suspension comes from the grace
// period running out (checkSubscription) or from the subscription deleted (SUBSCRIPTION_DELETED)
function statusFor(event: HandledEvent): Prisma.OrganizationUpdateInput | null {
  if (event === 'PAYMENT_CONFIRMED') return { subscriptionStatus: 'ACTIVE', gracePeriodEndsAt: null }
  if (event === 'PAYMENT_OVERDUE') return { subscriptionStatus: 'GRACE_PERIOD', gracePeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
  return null
}
