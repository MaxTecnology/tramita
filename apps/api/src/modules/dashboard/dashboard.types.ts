export interface DashboardMetrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    IN_PROGRESS: number
    REVIEW: number
    DONE: number
  }
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    mostUrgentDueDate: string | null
    daysOverdue: number
  }>
}
