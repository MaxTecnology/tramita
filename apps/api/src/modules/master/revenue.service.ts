import { prisma } from '@/lib/prisma'

export async function getRevenue() {
  const activeOrgs = await prisma.organization.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    include: { plan: { select: { priceMonthly: true } } },
  })

  const mrr = activeOrgs.reduce((sum, org) => sum + Number(org.plan.priceMonthly), 0)

  const churn = await prisma.organization.count({
    where: { subscriptionStatus: 'CANCELLED' },
  })

  return {
    mrr,
    totalOrgsAtivas: activeOrgs.length,
    churn,
  }
}
