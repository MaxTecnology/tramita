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
  const e2eClientNames = ['Cliente E2E', 'Carteira E2E A', 'Carteira E2E B', 'Cliente Cadastro E2E']
  // Recurring system boards and anything else attached to the E2E clients
  const otherBoards = await prisma.board.findMany({
    where: { organizationId: org.id, client: { name: { in: e2eClientNames } } },
    select: { id: true },
  })
  for (const b of otherBoards) {
    await prisma.board.delete({ where: { id: b.id } })
  }
  await prisma.protocol.deleteMany({ where: { organizationId: org.id, client: { name: { in: e2eClientNames } } } })
  await prisma.clientAssignment.deleteMany({ where: { client: { name: { in: e2eClientNames }, organizationId: org.id } } })
  await prisma.clientUserAccess.deleteMany({ where: { client: { name: { in: e2eClientNames }, organizationId: org.id } } })
  await prisma.client.deleteMany({
    where: { name: { in: e2eClientNames }, organizationId: org.id },
  })
  // Client user created through the client form spec
  await prisma.clientUser.deleteMany({ where: { email: 'cadastro-e2e@g2a.com.br', organizationId: org.id } })

  // Login do cliente final acontece via ClientUser (não mais via Client.email/passwordHash,
  // removidos pela migration 20260921210000_client_users) — o portal autentica contra
  // ClientUser e escopa o acesso via ClientUserAccess (cliente + departamento).
  // Cadastro completo (código do ERP, CNPJ válido, endereço de PJ) e o departamento "Geral"
  // atendendo o cliente com o admin como responsável — as invariantes de cobertura de
  // departamentos valem pros dados do E2E também.
  const client = await prisma.client.create({
    data: {
      name: 'Cliente E2E',
      organizationId: org.id,
      codigo: 'E2E-001',
      clientType: 'PJ',
      cnpj: '11222333000181',
      cep: '57312675',
      estado: 'AL',
      cidade: 'Arapiraca',
      bairro: 'Centro',
      logradouro: 'Rua E2E',
      numero: '100',
    },
  })

  await prisma.clientAssignment.create({
    data: { clientId: client.id, departmentId: department.id, userId: admin.id },
  })

  const clientUser = await prisma.clientUser.upsert({
    where: { email_organizationId: { email: 'cliente@g2a.com.br', organizationId: org.id } },
    update: { phone: '5582999990000' },
    create: {
      name: 'Cliente E2E',
      email: 'cliente@g2a.com.br',
      phone: '5582999990000',
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
  const board = await prisma.board.create({
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

  // Payment guide sent to the client (portal "Documentos recebidos" / "Marcar como pago")
  const firstTask = await prisma.task.findFirstOrThrow({ where: { column: { boardId: board.id } }, orderBy: { position: 'asc' } })
  await prisma.task.update({ where: { id: firstTask.id }, data: { visibleToClient: true } })
  await prisma.protocol.create({
    data: {
      organizationId: org.id, number: `E2E-${Date.now()}`, clientId: client.id, taskId: firstTask.id,
      title: 'Guia DAS E2E', content: 'Guia de teste', createdById: admin.id,
      requiresPayment: true, amount: '1234.56', dueDate: new Date(Date.UTC(2030, 0, 20)),
    },
  })

  // Monthly document request (portal "Enviar documentos"): recurring task of the current month
  const now = new Date()
  const competence = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  await prisma.board.create({
    data: {
      title: 'Tarefas Recorrentes (sistema)', organizationId: org.id, clientId: client.id, type: 'RECURRING_SYSTEM',
      columns: {
        create: [{
          title: 'Recorrentes', position: 0, statusEffect: 'NONE',
          tasks: {
            create: [{
              title: 'Apuração E2E', position: 0, priority: 'MEDIUM', status: 'BLOCKED', tags: [], creatorId: admin.id,
              departmentId: department.id, assigneeId: admin.id, visibleToClient: true, competence,
              documentRequirements: { create: [{ name: 'Extrato bancário E2E', position: 0 }] },
            }],
          },
        }],
      },
    },
  })

  // Transfer of responsibilities: "Saída E2E" serves two clients and leaves the office
  const staff = async (email: string, name: string) => prisma.user.upsert({
    where: { email },
    update: { isActive: true, name, organizationId: org.id, role: 'ORG_MEMBER' },
    create: { name, email, passwordHash: await bcrypt.hash('Equipe@2025', 10), role: 'ORG_MEMBER', organizationId: org.id },
  })
  const leaving = await staff('saida-e2e@g2a.com.br', 'Saída E2E')
  await staff('destino-e2e@g2a.com.br', 'Destino E2E')
  const portfolioUser = await prisma.clientUser.upsert({
    where: { email_organizationId: { email: 'carteira-e2e@g2a.com.br', organizationId: org.id } },
    update: { isActive: true },
    create: { name: 'Carteira E2E', email: 'carteira-e2e@g2a.com.br', passwordHash: await bcrypt.hash('Cliente@2025', 10), organizationId: org.id },
  })
  for (const [name, codigo, cnpj] of [['Carteira E2E A', 'E2E-101', '55101101000140'], ['Carteira E2E B', 'E2E-102', '55102202000136']]) {
    const c = await prisma.client.create({ data: { name, codigo, cnpj, organizationId: org.id, clientType: 'PJ' } })
    await prisma.clientAssignment.create({ data: { clientId: c.id, departmentId: department.id, userId: leaving.id } })
    await prisma.clientUserAccess.create({ data: { clientUserId: portfolioUser.id, clientId: c.id, departmentId: department.id } })
  }

  console.log('E2E seed concluído: org G2A + admin@g2a.com.br + cliente@g2a.com.br (ClientUser) + board "Processo E2E" + guia "Guia DAS E2E" + pedido mensal + carteira "Saída E2E"')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
