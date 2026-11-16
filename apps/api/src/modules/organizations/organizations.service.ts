import axios from 'axios'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword, generateRandomPassword } from '@/modules/auth/auth.service'
import * as asaas from '@/lib/asaas'
import type {
  UpdateOrgBody, RegisterOrgBody, CreateOrgByMasterBody,
} from '@/modules/organizations/organizations.schema'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

async function uniqueSlug(name: string): Promise<string> {
  const base = generateSlug(name)
  let slug = base
  let i = 1
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`
  }
  return slug
}

// What the public route may show of the new admin: never the password hash
function publicUser(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}

export async function register(data: RegisterOrgBody) {
  const existing = await prisma.organization.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  // Public signup is always a paid plan with its Asaas subscription (no public trial: it never
  // expired). Courtesy or manually billed offices are created by the Master.
  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')

  const slug = await uniqueSlug(data.name)
  const passwordHash = await hashPassword(data.adminPassword)

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.name, slug, cnpj: data.cnpj, email: data.email,
        phone: data.phone, planId: data.planId,
      },
    })
    const user = await tx.user.create({
      data: {
        name: data.adminName, email: data.email, passwordHash,
        role: 'ORG_ADMIN', organizationId: organization.id,
      },
    })
    return { organization, user }
  })

  try {
    const customer = await asaas.createCustomer({ name: data.name, email: data.email, cpfCnpj: data.cnpj })
    const subscription = await asaas.createSubscription({
      customer: customer.id,
      billingType: 'BOLETO',
      value: Number(plan.priceMonthly),
      cycle: 'MONTHLY',
      description: `Assinatura ${plan.name} — Tramita`,
    })
    await prisma.organization.update({
      where: { id: organization.id },
      data: { asaasCustomerId: customer.id, asaasSubscriptionId: subscription.id },
    })
    organization.asaasCustomerId = customer.id
    organization.asaasSubscriptionId = subscription.id
  } catch (err) {
    if (err instanceof AppError) throw err
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.organization.delete({ where: { id: organization.id } })
    // The billing's own reasons go to the log (no API key, no personal data) and to the person
    const asaasErrors = asaas.asaasErrorReasons(err)
    logger.error(
      { asaasErrors, status: axios.isAxiosError(err) ? err.response?.status : undefined, reason: err instanceof Error ? err.message : String(err) },
      'Cadastro do escritório: Asaas recusou a criação do cliente/assinatura',
    )
    const detail = asaasErrors.map((e) => e.slice(e.indexOf(': ') + 2)).filter(Boolean).join(' ')
    throw new AppError(502, detail ? `Erro ao integrar com sistema de cobrança: ${detail}` : 'Erro ao integrar com sistema de cobrança. Tente novamente.')
  }

  return { organization, user: publicUser(user) }
}

export async function createOrganizationByMaster(data: CreateOrgByMasterBody) {
  const existing = await prisma.organization.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')

  const slug = await uniqueSlug(data.name)
  const temporaryPassword = generateRandomPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  const { organization, user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.name, slug, cnpj: data.cnpj, email: data.email,
        phone: data.phone, planId: data.planId, subscriptionStatus: 'ACTIVE',
      },
    })
    const user = await tx.user.create({
      data: {
        name: data.adminName, email: data.email, passwordHash,
        role: 'ORG_ADMIN', organizationId: organization.id,
      },
    })
    return { organization, user }
  })

  if (data.createAsaasSubscription) {
    try {
      const customer = await asaas.createCustomer({ name: data.name, email: data.email, cpfCnpj: data.cnpj })
      const subscription = await asaas.createSubscription({
        customer: customer.id,
        billingType: 'BOLETO',
        value: Number(plan.priceMonthly),
        cycle: 'MONTHLY',
        description: `Assinatura ${plan.name} — Tramita`,
      })
      await prisma.organization.update({
        where: { id: organization.id },
        data: { asaasCustomerId: customer.id, asaasSubscriptionId: subscription.id },
      })
      organization.asaasCustomerId = customer.id
      organization.asaasSubscriptionId = subscription.id
    } catch (err) {
      await prisma.user.delete({ where: { id: user.id } })
      await prisma.organization.delete({ where: { id: organization.id } })
      throw new AppError(502, 'Erro ao integrar com sistema de cobrança. Tente novamente.')
    }
  }

  return {
    organization,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    temporaryPassword,
  }
}

export async function listPublicPlans() {
  return prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } })
}

export async function getOrgSubscription(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      plan: { select: { id: true, name: true, maxClients: true, priceMonthly: true } },
      subscriptionHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { clients: { where: { isActive: true } } } },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')

  return {
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt,
    gracePeriodEndsAt: org.gracePeriodEndsAt,
    asaasSubscriptionId: org.asaasSubscriptionId,
    plan: org.plan,
    clientsCount: org._count.clients,
    subscriptionHistory: org.subscriptionHistory,
  }
}

export async function changePlan(organizationId: string, planId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (!plan || !plan.isActive) throw new AppError(404, 'Plano não encontrado')
  return prisma.organization.update({ where: { id: organizationId }, data: { planId } })
}

// ── Master functions (kept from Phase 2) ─────────────────────────────────────

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
    id: org.id, name: org.name, slug: org.slug, email: org.email,
    subscriptionStatus: org.subscriptionStatus, planId: org.planId,
    planName: org.plan.name, clientsCount: org._count.clients,
    usersCount: org._count.users, createdAt: org.createdAt,
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
      users: {
        where: { isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return {
    id: org.id, name: org.name, slug: org.slug, cnpj: org.cnpj, email: org.email,
    phone: org.phone, subscriptionStatus: org.subscriptionStatus, planId: org.planId,
    planName: org.plan.name, clientsCount: org._count.clients, usersCount: org._count.users,
    gracePeriodEndsAt: org.gracePeriodEndsAt, trialEndsAt: org.trialEndsAt,
    subscriptionHistory: org.subscriptionHistory, createdAt: org.createdAt,
    users: org.users,
  }
}

export async function updateOrganization(id: string, data: UpdateOrgBody) {
  const org = await prisma.organization.findUnique({ where: { id } })
  if (!org) throw new AppError(404, 'Organização não encontrada')
  return prisma.organization.update({ where: { id }, data })
}
