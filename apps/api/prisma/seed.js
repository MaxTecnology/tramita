import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
    // Plans
    await prisma.plan.upsert({
        where: { id: 'plan-starter' },
        update: {},
        create: {
            id: 'plan-starter',
            name: 'Starter',
            maxClients: 15,
            priceMonthly: 97.0,
            features: { pdf: false, sse: false, attachments: false },
        },
    });
    const pro = await prisma.plan.upsert({
        where: { id: 'plan-pro' },
        update: {},
        create: {
            id: 'plan-pro',
            name: 'Pro',
            maxClients: 50,
            priceMonthly: 197.0,
            features: { pdf: true, sse: true, attachments: true },
        },
    });
    await prisma.plan.upsert({
        where: { id: 'plan-enterprise' },
        update: {},
        create: {
            id: 'plan-enterprise',
            name: 'Enterprise',
            maxClients: 999,
            priceMonthly: 497.0,
            features: { pdf: true, sse: true, attachments: true, whiteLabel: true },
        },
    });
    // Master org (AutoHubs itself)
    const masterOrg = await prisma.organization.upsert({
        where: { slug: 'autohubs' },
        update: {},
        create: {
            name: 'AutoHubs',
            slug: 'autohubs',
            email: 'contato@autohubs.com.br',
            planId: pro.id,
            subscriptionStatus: 'ACTIVE',
        },
    });
    // MASTER user
    await prisma.user.upsert({
        where: { email: 'master@autohubs.com.br' },
        update: {},
        create: {
            name: 'AutoHubs Master',
            email: 'master@autohubs.com.br',
            passwordHash: await bcrypt.hash(process.env.MASTER_PASSWORD ?? 'Master@AutoHubs2025', 10),
            role: 'MASTER',
            organizationId: masterOrg.id,
        },
    });
    // G2A org (first client org)
    const g2aOrg = await prisma.organization.upsert({
        where: { slug: 'g2a' },
        update: {},
        create: {
            name: 'G2A Contabilidade',
            slug: 'g2a',
            email: 'contato@g2a.com.br',
            planId: pro.id,
            subscriptionStatus: 'ACTIVE',
        },
    });
    await prisma.user.upsert({
        where: { email: 'admin@g2a.com.br' },
        update: {},
        create: {
            name: 'Admin G2A',
            email: 'admin@g2a.com.br',
            passwordHash: await bcrypt.hash('G2A@Admin2025', 10),
            role: 'ORG_ADMIN',
            organizationId: g2aOrg.id,
        },
    });
    console.log('Seed concluído: planos Starter/Pro/Enterprise, usuário MASTER, org G2A');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map