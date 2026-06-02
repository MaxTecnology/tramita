import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { UpdateOrgBody } from '@/modules/organizations/organizations.schema'

export async function listOrganizations() {
  const orgs = await prisma.organization.findMany({
    include: {
      plan: { select: { name: true } },
      _count: {
        select: {
          clients: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return orgs.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    email: org.email,
    subscriptionStatus: org.subscriptionStatus,
    planId: org.planId,
    planName: org.plan.name,
    clientsCount: org._count.clients,
    usersCount: org._count.users,
    createdAt: org.createdAt,
  }))
}

export async function getOrganization(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      plan: { select: { name: true } },
      _count: {
        select: {
          clients: { where: { isActive: true } },
          users: { where: { isActive: true } },
        },
      },
      subscriptionHistory: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    cnpj: org.cnpj,
    email: org.email,
    phone: org.phone,
    subscriptionStatus: org.subscriptionStatus,
    planId: org.planId,
    planName: org.plan.name,
    clientsCount: org._count.clients,
    usersCount: org._count.users,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    trialEndsAt: org.trialEndsAt,
    subscriptionHistory: org.subscriptionHistory,
    createdAt: org.createdAt,
  }
}

export async function updateOrganization(id: string, data: UpdateOrgBody) {
  const org = await prisma.organization.findUnique({ where: { id } })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return prisma.organization.update({ where: { id }, data })
}
