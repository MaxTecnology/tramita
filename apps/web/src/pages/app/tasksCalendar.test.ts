import { describe, it, expect } from 'vitest'
import { buildCalendarGrid, getCalendarGridRange, type CalendarTaskLike } from './tasksCalendar'

function task(overrides: Partial<CalendarTaskLike>): CalendarTaskLike {
  return { id: 'x', targetDate: null, dueDate: null, status: 'OPEN', ...overrides }
}

describe('buildCalendarGrid', () => {
  it('posiciona a tarefa no dia de targetDate', () => {
    const t = task({ id: 't1', targetDate: '2026-03-15T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-15')
    expect(day?.tasks.map((x) => x.id)).toEqual(['t1'])
  })

  it('usa dueDate como fallback quando targetDate é null', () => {
    const t = task({ id: 't2', dueDate: '2026-03-20T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-20')
    expect(day?.tasks.map((x) => x.id)).toEqual(['t2'])
  })

  it('tarefa sem targetDate nem dueDate não aparece em nenhum dia', () => {
    const t = task({ id: 't3' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const allIds = grid.flatMap((d) => d.tasks.map((x) => x.id))
    expect(allIds).not.toContain('t3')
  })

  it('tarefa DISREGARDED é excluída mesmo com targetDate válido', () => {
    const t = task({ id: 't4', targetDate: '2026-03-15T00:00:00.000Z', status: 'DISREGARDED' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-15')
    expect(day?.tasks).toHaveLength(0)
  })

  it('a grade cobre semanas completas, incluindo dias do mês vizinho', () => {
    // Abril de 2026 começa numa quarta-feira (dia 1 = quarta, getUTCDay() === 3) — a grade
    // precisa incluir domingo/segunda/terça de março antes do dia 1.
    // (Nota: março/2026 — usado na versão original deste teste — na verdade começa num domingo,
    // então não exercitava o caso de dias líderes; trocado por abril/2026 para testar o cenário
    // real de dias do mês anterior preenchendo a primeira semana.)
    const grid = buildCalendarGrid([], new Date('2026-04-01T00:00:00.000Z'))
    expect(grid.length % 7).toBe(0)
    expect(grid[0].isCurrentMonth).toBe(false)
    expect(grid.some((d) => d.dateKey === '2026-04-01' && d.isCurrentMonth)).toBe(true)
    expect(grid.some((d) => d.dateKey === '2026-04-30' && d.isCurrentMonth)).toBe(true)
  })

  it('fica correto independente do fuso-horário local do processo de teste (regressão UTC)', () => {
    // targetDate em meia-noite UTC do último dia do mês não deve "escorregar" pro mês seguinte
    // nem pro anterior ao agrupar.
    const t = task({ id: 't5', targetDate: '2026-02-28T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-02-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-02-28')
    expect(day?.isCurrentMonth).toBe(true)
    expect(day?.tasks.map((x) => x.id)).toEqual(['t5'])
  })
})

describe('getCalendarGridRange', () => {
  it('retorna um intervalo que cobre a grade inteira, não só o mês estrito', () => {
    const { from, to } = getCalendarGridRange(new Date('2026-03-01T00:00:00.000Z'))
    expect(from <= '2026-03-01').toBe(true)
    expect(to >= '2026-03-31').toBe(true)
  })
})
