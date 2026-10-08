import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { ProductivityQuery, ProductivityMetrics, MetricsBreakdown } from './dashboard.types'

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

    // Agregados a nível de TAREFA — recorrentes moram no board de sistema RECURRING_SYSTEM mas
    // são tarefas reais de trabalho da equipe, então NÃO filtramos type: 'OS' aqui (diferente
    // das contagens/listagens a nível de BOARD acima e abaixo, onde o board de sistema nunca
    // deve aparecer como "processo").
    prisma.task.count({
      where: {
        status: 'DONE',
        updatedAt: { gte: startOfMonth },
        column: { board: { organizationId, isActive: true } },
      },
    }),

    prisma.task.count({
      where: {
        priority: 'URGENT',
        status: { notIn: ['DONE', 'DISREGARDED'] },
        column: { board: { organizationId, isActive: true } },
      },
    }),

    prisma.task.groupBy({
      by: ['status'],
      where: { column: { board: { organizationId, isActive: true } } },
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

export async function getTeamMembers(organizationId: string): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function emptyBreakdown(): MetricsBreakdown {
  return {
    volume: { os: 0, recurring: 0 },
    onTimeRate: {
      target: { onTime: 0, late: 0, applicable: 0 },
      due: { onTime: 0, late: 0, applicable: 0 },
    },
    avgCompletionDays: { os: null, recurring: null },
    lateClosureCount: 0,
    currentLoad: { os: 0, recurring: 0 },
    blocked: { taskCount: 0, totalDays: 0 },
  }
}

function bucketKey(type: 'OS' | 'RECURRING_SYSTEM'): 'os' | 'recurring' {
  return type === 'OS' ? 'os' : 'recurring'
}

function clippedDurationMs(start: Date, end: Date, from: Date, to: Date): number {
  const clippedStart = Math.max(start.getTime(), from.getTime())
  const clippedEnd = Math.min(end.getTime(), to.getTime())
  return Math.max(0, clippedEnd - clippedStart)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export async function getProductivityMetrics(
  organizationId: string,
  query: ProductivityQuery,
): Promise<ProductivityMetrics> {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  const lateClosureThresholdDays = config?.lateClosureThresholdDays ?? 2

  const baseWhere: Prisma.TaskWhereInput = {
    column: {
      board: {
        organizationId,
        ...(query.boardType ? { type: query.boardType } : {}),
      },
    },
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.userId ? { assigneeId: query.userId } : {}),
  }

  const taskSelect = {
    id: true,
    createdAt: true,
    completedAt: true,
    targetDate: true,
    dueDate: true,
    assigneeId: true,
    departmentId: true,
    assignee: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    column: { select: { board: { select: { type: true } } } },
  } satisfies Prisma.TaskSelect

  const [completedTasks, openTasks] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, completedAt: { gte: query.from, lte: query.to } },
      select: taskSelect,
    }),
    prisma.task.findMany({
      where: { ...baseWhere, status: { notIn: ['DONE', 'DISREGARDED'] } },
      select: taskSelect,
    }),
  ])

  const candidateIds = [...new Set([...completedTasks, ...openTasks].map((t) => t.id))]
  const blockedHistory = candidateIds.length > 0
    ? await prisma.taskHistory.findMany({
        where: {
          action: 'status_changed',
          taskId: { in: candidateIds },
          OR: [{ toValue: 'BLOCKED' }, { fromValue: 'BLOCKED' }],
        },
        select: { taskId: true, fromValue: true, toValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []

  const fullHistoryForLateClosure = completedTasks.length > 0
    ? await prisma.taskHistory.findMany({
        where: { taskId: { in: completedTasks.map((t) => t.id) } },
        select: { taskId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : []

  const byPerson = new Map<string, { userId: string; userName: string; breakdown: MetricsBreakdown }>()
  const byDepartment = new Map<string, { departmentId: string; departmentName: string; breakdown: MetricsBreakdown }>()

  function ensurePerson(id: string, name: string) {
    if (!byPerson.has(id)) byPerson.set(id, { userId: id, userName: name, breakdown: emptyBreakdown() })
    return byPerson.get(id)!.breakdown
  }
  function ensureDept(id: string, name: string) {
    if (!byDepartment.has(id)) byDepartment.set(id, { departmentId: id, departmentName: name, breakdown: emptyBreakdown() })
    return byDepartment.get(id)!.breakdown
  }

  function targetsForTask(task: (typeof completedTasks)[number]): MetricsBreakdown[] {
    const targets: MetricsBreakdown[] = []
    if (task.assignee) targets.push(ensurePerson(task.assignee.id, task.assignee.name))
    targets.push(ensureDept(task.department.id, task.department.name))
    return targets
  }

  const historyByTask = new Map<string, typeof blockedHistory>()
  for (const h of blockedHistory) {
    const bucket = historyByTask.get(h.taskId) ?? []
    bucket.push(h)
    historyByTask.set(h.taskId, bucket)
  }

  const lateClosureHistoryByTask = new Map<string, typeof fullHistoryForLateClosure>()
  for (const h of fullHistoryForLateClosure) {
    const bucket = lateClosureHistoryByTask.get(h.taskId) ?? []
    bucket.push(h)
    lateClosureHistoryByTask.set(h.taskId, bucket)
  }

  const now = new Date()

  const completionDaysAccumulator = new Map<string, { os: number[]; recurring: number[] }>()
  function accDays(key: string, days: number, type: 'os' | 'recurring') {
    const acc = completionDaysAccumulator.get(key) ?? { os: [], recurring: [] }
    acc[type].push(days)
    completionDaysAccumulator.set(key, acc)
  }

  for (const task of completedTasks) {
    const type = bucketKey(task.column.board.type)
    const targets = targetsForTask(task)

    for (const breakdown of targets) {
      breakdown.volume[type]++

      if (task.targetDate) {
        breakdown.onTimeRate.target.applicable++
        if (task.completedAt! <= task.targetDate) breakdown.onTimeRate.target.onTime++
        else breakdown.onTimeRate.target.late++
      }
      if (task.dueDate) {
        breakdown.onTimeRate.due.applicable++
        if (task.completedAt! <= task.dueDate) breakdown.onTimeRate.due.onTime++
        else breakdown.onTimeRate.due.late++
      }

      const completionDays = (task.completedAt!.getTime() - task.createdAt.getTime()) / MS_PER_DAY
      const accKey = task.assignee ? `p:${task.assignee.id}` : `d:${task.department.id}`
      accDays(accKey, completionDays, type)

      const taskHistoryEntries = lateClosureHistoryByTask.get(task.id) ?? []
      const priorEntry = taskHistoryEntries.find((h) => h.createdAt.getTime() < task.completedAt!.getTime())
      const gapDays = priorEntry
        ? (task.completedAt!.getTime() - priorEntry.createdAt.getTime()) / MS_PER_DAY
        : 0
      if (gapDays > lateClosureThresholdDays) breakdown.lateClosureCount++
    }
  }

  for (const task of openTasks) {
    const type = bucketKey(task.column.board.type)
    for (const breakdown of targetsForTask(task)) {
      breakdown.currentLoad[type]++
    }
  }

  const allCandidateTasks = [...completedTasks, ...openTasks]
  const taskById = new Map(allCandidateTasks.map((t) => [t.id, t]))

  for (const [taskId, entries] of historyByTask) {
    const task = taskById.get(taskId)
    if (!task) continue

    let blockedSince: Date | null = null
    let totalClippedMs = 0
    for (const entry of entries) {
      if (entry.toValue === 'BLOCKED') blockedSince = entry.createdAt
      else if (entry.fromValue === 'BLOCKED' && blockedSince) {
        totalClippedMs += clippedDurationMs(blockedSince, entry.createdAt, query.from, query.to)
        blockedSince = null
      }
    }
    if (blockedSince) {
      totalClippedMs += clippedDurationMs(blockedSince, now, query.from, query.to)
    }

    if (totalClippedMs > 0) {
      for (const breakdown of targetsForTask(task)) {
        breakdown.blocked.taskCount++
        breakdown.blocked.totalDays += totalClippedMs / MS_PER_DAY
      }
    }
  }

  for (const [key, acc] of completionDaysAccumulator) {
    const [kind, id] = key.split(':', 2) as ['p' | 'd', string]
    const breakdown = kind === 'p'
      ? byPerson.get(id)?.breakdown
      : byDepartment.get(id)?.breakdown
    if (!breakdown) continue
    breakdown.avgCompletionDays.os = average(acc.os)
    breakdown.avgCompletionDays.recurring = average(acc.recurring)
  }

  return {
    period: { from: query.from.toISOString(), to: query.to.toISOString() },
    byPerson: [...byPerson.values()].map((p) => ({ userId: p.userId, userName: p.userName, ...p.breakdown })),
    byDepartment: [...byDepartment.values()].map((d) => ({ departmentId: d.departmentId, departmentName: d.departmentName, ...d.breakdown })),
  }
}
