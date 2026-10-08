export interface DashboardMetrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    BLOCKED: number
    DONE: number
    DISREGARDED: number
  }
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    mostUrgentDueDate: string | null
    daysOverdue: number
  }>
}

export interface ProductivityQuery {
  from: Date
  to: Date
  departmentId?: string
  userId?: string
  boardType?: 'OS' | 'RECURRING_SYSTEM'
}

export interface OnTimeBucket {
  onTime: number
  late: number
  applicable: number // denominador — quantas tarefas tinham a data de referência setada
}

export interface MetricsBreakdown {
  volume: { os: number; recurring: number }
  onTimeRate: { target: OnTimeBucket; due: OnTimeBucket }
  avgCompletionDays: { os: number | null; recurring: number | null }
  lateClosureCount: number
  currentLoad: { os: number; recurring: number }
  blocked: { taskCount: number; totalDays: number }
}

export interface PersonMetrics extends MetricsBreakdown { userId: string; userName: string }
export interface DepartmentMetrics extends MetricsBreakdown { departmentId: string; departmentName: string }

export interface ProductivityMetrics {
  period: { from: string; to: string }
  byPerson: PersonMetrics[]
  byDepartment: DepartmentMetrics[]
}
