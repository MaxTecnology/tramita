import { prisma } from '@/lib/prisma'

export async function getDashboardMetrics(organizationId: string) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [
    activeBoards,
    overdueBoards,
    completedThisMonth,
    urgentOpen,
    tasksByStatus,
    atRiskBoards,
  ] = await Promise.all([
    prisma.board.count({ where: { organizationId, isActive: true, type: 'OS' } }),

    prisma.board.count({
      where: {
        organizationId,
        isActive: true,
        type: 'OS',
        OR: [
          {
            columns: {
              some: {
                tasks: {
                  some: { dueDate: { lt: now }, status: { notIn: ['DONE', 'DISREGARDED'] } },
                },
              },
            },
          },
          { dueDate: { lt: now } },
        ],
      },
    }),

    prisma.task.count({
      where: {
        status: 'DONE',
        updatedAt: { gte: startOfMonth },
        column: { board: { organizationId, isActive: true, type: 'OS' } },
      },
    }),

    prisma.task.count({
      where: {
        priority: 'URGENT',
        status: { notIn: ['DONE', 'DISREGARDED'] },
        column: { board: { organizationId, isActive: true, type: 'OS' } },
      },
    }),

    prisma.task.groupBy({
      by: ['status'],
      where: { column: { board: { organizationId, isActive: true, type: 'OS' } } },
      _count: { status: true },
    }),

    prisma.board.findMany({
      where: {
        organizationId,
        isActive: true,
        type: 'OS',
        OR: [
          {
            columns: {
              some: {
                tasks: {
                  some: { dueDate: { lte: in7days }, status: { notIn: ['DONE', 'DISREGARDED'] } },
                },
              },
            },
          },
          { dueDate: { lte: in7days } },
        ],
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        client: { select: { name: true } },
        columns: {
          select: {
            tasks: {
              where: { dueDate: { not: null }, status: { notIn: ['DONE', 'DISREGARDED'] } },
              select: { dueDate: true },
              orderBy: { dueDate: 'asc' },
            },
          },
        },
      },
      take: 8,
    }),
  ])

  const statusMap: Record<string, number> = {}
  for (const g of tasksByStatus) {
    statusMap[g.status] = g._count.status
  }

  const atRisk = atRiskBoards
    .map((b) => {
      const allDueDates = b.columns
        .flatMap((c) => c.tasks)
        .map((t) => new Date(t.dueDate!))
        .sort((a, z) => a.getTime() - z.getTime())
      const earliest = allDueDates[0] ?? (b.dueDate ? new Date(b.dueDate) : null)
      const daysOverdue = earliest
        ? Math.floor((now.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24))
        : 0
      return {
        boardId: b.id,
        boardTitle: b.title,
        clientName: b.client.name,
        mostUrgentDueDate: earliest?.toISOString() ?? null,
        daysOverdue,
      }
    })
    .sort((a, z) => z.daysOverdue - a.daysOverdue)

  return {
    kpis: {
      activeBoards,
      overdueBoards,
      completedTasksThisMonth: completedThisMonth,
      urgentOpenTasks: urgentOpen,
    },
    tasksByStatus: {
      OPEN: statusMap['OPEN'] ?? 0,
      STARTED: statusMap['STARTED'] ?? 0,
      BLOCKED: statusMap['BLOCKED'] ?? 0,
      DONE: statusMap['DONE'] ?? 0,
      DISREGARDED: statusMap['DISREGARDED'] ?? 0,
    },
    atRisk,
  }
}
