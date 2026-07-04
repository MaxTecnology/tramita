import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Plano interno só para satisfazer o vínculo obrigatório Organization.planId
  // da própria org AutoHubs — isActive: false o esconde da listagem pública de
  // registro (GET /organizations/plans), só aparece pro Master no painel
  // interno de planos. Os planos reais (Starter/Pro/Enterprise) e a primeira
  // org cliente (ex: G2A) são cadastrados depois, pelo próprio painel.
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

  console.log(`Seed concluído: org AutoHubs + usuário MASTER (${masterEmail})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
