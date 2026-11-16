import { prisma } from '@/lib/prisma'

export async function getRevenue() {
  const activeOrgs = await prisma.organization.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    include: { plan: { select: { priceMonthly: true } } },
  })

  const sum = (orgs: typeof activeOrgs) => orgs.reduce((total, org) => total + Number(org.plan.priceMonthly), 0)
  const mrr = sum(activeOrgs)
  // Asaas collects by itself; a direct agreement is collected by AutoHubs
  const mrrAsaas = sum(activeOrgs.filter((o) => o.billingMode === 'ASAAS'))
  const mrrManual = sum(activeOrgs.filter((o) => o.billingMode === 'MANUAL'))

  const churn = await prisma.organization.count({
    where: { subscriptionStatus: 'CANCELLED' },
  })

  return {
    mrr,
    mrrAsaas,
    mrrManual,
    totalOrgsAtivas: activeOrgs.length,
    churn,
  }
}
