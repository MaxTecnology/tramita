import { utcDateKey } from '@/lib/dates'
import type { Task } from '@/types'

export interface CalendarTaskLike {
  id: string
  targetDate: string | null
  dueDate: string | null
  status: Task['status']
}

export interface CalendarDay<T extends CalendarTaskLike = CalendarTaskLike> {
  dateKey: string
  dayOfMonth: number
  isCurrentMonth: boolean
  tasks: T[]
}

function gridLeadingDays(month: Date): { year: number; monthIndex: number; firstWeekday: number; daysInMonth: number } {
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() // 0 = domingo
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return { year, monthIndex, firstWeekday, daysInMonth }
}

/** Intervalo [from, to] (chaves 'YYYY-MM-DD') que cobre a grade completa de semanas do mês,
 * incluindo os dias do mês anterior/seguinte que preenchem a primeira/última semana — é a janela
 * que `GET /tasks?dateFrom=...&dateTo=...` precisa buscar pra alimentar o calendário. */
export function getCalendarGridRange(month: Date): { from: string; to: string } {
  const { year, monthIndex, firstWeekday, daysInMonth } = gridLeadingDays(month)
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7
  const gridStart = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday))
  const gridEnd = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + totalCells - 1))
  return { from: utcDateKey(gridStart), to: utcDateKey(gridEnd) }
}

/** Agrupa `tasks` por dia (via targetDate, com fallback pra dueDate) numa grade de semanas
 * completas cobrindo `month`. Tarefa sem nenhuma das duas datas, ou com status DISREGARDED, não
 * aparece em dia nenhum. */
export function buildCalendarGrid<T extends CalendarTaskLike>(tasks: T[], month: Date): CalendarDay<T>[] {
  const { year, monthIndex, firstWeekday, daysInMonth } = gridLeadingDays(month)
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7

  const byDateKey = new Map<string, T[]>()
  for (const task of tasks) {
    if (task.status === 'DISREGARDED') continue
    const dateSource = task.targetDate ?? task.dueDate
    if (!dateSource) continue
    const key = utcDateKey(dateSource)
    const list = byDateKey.get(key) ?? []
    list.push(task)
    byDateKey.set(key, list)
  }

  const days: CalendarDay<T>[] = []
  for (let i = 0; i < totalCells; i++) {
    const current = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + i))
    const key = utcDateKey(current)
    days.push({
      dateKey: key,
      dayOfMonth: current.getUTCDate(),
      isCurrentMonth: current.getUTCMonth() === monthIndex,
      tasks: byDateKey.get(key) ?? [],
    })
  }

  return days
}
