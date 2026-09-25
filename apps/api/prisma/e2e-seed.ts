// apps/api/prisma/e2e-seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const dbUrl = process.env.DATABASE_URL ?? ''
if (!dbUrl.includes('_test') || process.env.NODE_ENV === 'production') {
  throw new Error(
    'e2e-seed.ts só pode rodar contra um banco de teste (DATABASE_URL precisa apontar para um banco cujo nome contenha "_test", e NODE_ENV não pode ser "production"). ' +
    `DATABASE_URL atual: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`,
  )
}

const prisma = new PrismaClient()

async function main() {
  // Depende do seed base (prisma/seed.ts) já ter rodado antes — usa o plano
  // "Pro" criado lá. A org G2A só existe em banco de teste/E2E, nunca em
  // produção — por isso fica isolada aqui em vez de em prisma/seed.ts.
  const plan = await prisma.plan.findFirstOrThrow({ where: { name: 'Pro' } })

  const org = await prisma.organization.upsert({
    where: { slug: 'g2a' },
    update: {},
    create: {
      name: 'G2A Contabilidade',
      slug: 'g2a',
      email: 'contato@g2a.com.br',
      planId: plan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: 'admin@g2a.com.br' },
    update: {},
    create: {
      name: 'Admin G2A',
      email: 'admin@g2a.com.br',
      passwordHash: await bcrypt.hash('G2A@Admin2025', 10),
      role: 'ORG_ADMIN',
      organizationId: org.id,
    },
  })

  const department = await prisma.department.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'Geral' } },
    update: {},
    create: { name: 'Geral', organizationId: org.id },
  })

  // Remove stale E2E data to guarantee a clean slate
  const staleBoards = await prisma.board.findMany({
    where: { organizationId: org.id, title: 'Processo E2E' },
    select: { id: true },
  })
  for (const b of staleBoards) {
    await prisma.board.delete({ where: { id: b.id } })
  }
  await prisma.client.deleteMany({
    where: { name: 'Cliente E2E', organizationId: org.id },
  })

  // Login do cliente final acontece via ClientUser (não mais via Client.email/passwordHash,
  // removidos pela migration 20260921210000_client_users) — o portal autentica contra
  // ClientUser e escopa o acesso via ClientUserAccess (cliente + departamento).
  const client = await prisma.client.create({
    data: { name: 'Cliente E2E', organizationId: org.id },
  })

  const clientUser = await prisma.clientUser.upsert({
    where: { email_organizationId: { email: 'cliente@g2a.com.br', organizationId: org.id } },
    update: {},
    create: {
      name: 'Cliente E2E',
      email: 'cliente@g2a.com.br',
      passwordHash: await bcrypt.hash('Cliente@2025', 10),
      organizationId: org.id,
    },
  })

  await prisma.clientUserAccess.upsert({
    where: {
      clientUserId_clientId_departmentId: {
        clientUserId: clientUser.id,
        clientId: client.id,
        departmentId: department.id,
      },
    },
    update: {},
    create: { clientUserId: clientUser.id, clientId: client.id, departmentId: department.id },
  })

  // Create board with 3 columns and 2 tasks in the first column
  await prisma.board.create({
    data: {
      title: 'Processo E2E',
      organizationId: org.id,
      clientId: client.id,
      columns: {
        create: [
          {
            title: 'Pendente',
            position: 0,
            statusEffect: 'NONE',
            color: '#6B7280',
            tasks: {
              create: [
                {
                  title: 'Abertura de empresa',
                  position: 0,
                  priority: 'HIGH',
                  status: 'OPEN',
                  tags: [],
                  creatorId: admin.id,
                  departmentId: department.id,
                },
                {
                  title: 'Inscrição estadual',
                  position: 1,
                  priority: 'MEDIUM',
                  status: 'OPEN',
                  tags: [],
                  creatorId: admin.id,
                  departmentId: department.id,
                },
              ],
            },
          },
          { title: 'Em andamento', position: 1, statusEffect: 'NONE', color: '#3B82F6' },
          { title: 'Concluído', position: 2, statusEffect: 'DONE', color: '#10B981' },
        ],
      },
    },
  })

  console.log('E2E seed concluído: org G2A + admin@g2a.com.br + cliente@g2a.com.br (ClientUser) + board "Processo E2E"')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
