// apps/api/prisma/e2e-seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'g2a' } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@g2a.com.br' } });
    // Remove stale E2E data to guarantee a clean slate
    const staleBoards = await prisma.board.findMany({
        where: { organizationId: org.id, title: 'Processo E2E' },
        select: { id: true },
    });
    for (const b of staleBoards) {
        await prisma.board.delete({ where: { id: b.id } });
    }
    await prisma.client.deleteMany({
        where: { email: 'cliente@g2a.com.br', organizationId: org.id },
    });
    // Create E2E client (portal user)
    const client = await prisma.client.create({
        data: {
            name: 'Cliente E2E',
            email: 'cliente@g2a.com.br',
            passwordHash: await bcrypt.hash('Cliente@2025', 10),
            organizationId: org.id,
        },
    });
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
                        isFinal: false,
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
                                },
                                {
                                    title: 'Inscrição estadual',
                                    position: 1,
                                    priority: 'MEDIUM',
                                    status: 'OPEN',
                                    tags: [],
                                    creatorId: admin.id,
                                },
                            ],
                        },
                    },
                    { title: 'Em andamento', position: 1, isFinal: false, color: '#3B82F6' },
                    { title: 'Concluído', position: 2, isFinal: true, color: '#10B981' },
                ],
            },
        },
    });
    console.log('E2E seed concluído: cliente@g2a.com.br + board "Processo E2E"');
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=e2e-seed.js.map