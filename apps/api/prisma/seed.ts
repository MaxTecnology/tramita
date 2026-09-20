import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Plano interno só para satisfazer o vínculo obrigatório Organization.planId
  // da própria org AutoHubs — isActive: false o esconde da listagem pública de
  // registro (GET /organizations/plans), só aparece pro Master no painel
  // interno de planos.
  const internalPlan = await prisma.plan.upsert({
    where: { id: 'plan-internal-autohubs' },
    update: {},
    create: {
      id: 'plan-internal-autohubs',
      name: 'Interno (AutoHubs)',
      maxClients: 0,
      priceMonthly: 0,
      features: {},
      isActive: false,
    },
  })

  // Planos públicos — valores placeholder, editáveis pelo painel Master
  // (/master/plans) sem precisar de redeploy.
  const publicPlans = [
    { id: 'plan-starter', name: 'Starter', maxClients: 10, priceMonthly: 97 },
    { id: 'plan-pro', name: 'Pro', maxClients: 50, priceMonthly: 197 },
    { id: 'plan-enterprise', name: 'Enterprise', maxClients: 500, priceMonthly: 497 },
  ]
  for (const plan of publicPlans) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: {}, isActive: true },
    })
  }

  // Master org (AutoHubs itself)
  const masterOrg = await prisma.organization.upsert({
    where: { slug: 'autohubs' },
    update: {},
    create: {
      name: 'AutoHubs',
      slug: 'autohubs',
      email: 'contato@autohubs.com.br',
      planId: internalPlan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })

  // MASTER user — update always re-hashes so reruns respect the current MASTER_PASSWORD
  const masterEmail = process.env.MASTER_EMAIL ?? 'master@autohubs.com.br'
  if (!process.env.MASTER_PASSWORD && process.env.NODE_ENV === 'production') {
    throw new Error('MASTER_PASSWORD precisa estar definida em produção — não usar o valor padrão de desenvolvimento.')
  }
  const masterPasswordHash = await bcrypt.hash(
    process.env.MASTER_PASSWORD ?? 'Master@AutoHubs2025',
    10,
  )
  await prisma.user.upsert({
    where: { email: masterEmail },
    update: { passwordHash: masterPasswordHash },
    create: {
      name: 'AutoHubs Master',
      email: masterEmail,
      passwordHash: masterPasswordHash,
      role: 'MASTER',
      organizationId: masterOrg.id,
    },
  })

  console.log(
    `Seed concluído: org AutoHubs + usuário MASTER (${masterEmail}) + ${publicPlans.length} planos públicos`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
