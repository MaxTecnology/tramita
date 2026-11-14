import { describe, it, expect } from 'vitest'
import { STATUS_FILTER_OPTIONS, DEFAULT_STATUS_FILTER, statusFilterParams } from './tasksStatus'

describe('filtro de status da tela Tarefas', () => {
  it('starts on "Pendentes": everything not finished, including blocked and started tasks', () => {
    expect(DEFAULT_STATUS_FILTER).toBe('PENDING')
    expect(statusFilterParams('PENDING')).toEqual({ openOnly: 'true' })
  })

  it('"Todos" sends no status; a single status is sent as is', () => {
    expect(statusFilterParams('ALL')).toEqual({})
    expect(statusFilterParams('BLOCKED')).toEqual({ status: 'BLOCKED' })
  })

  it('lists Pendentes and Todos before the individual statuses', () => {
    expect(STATUS_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      'Pendentes', 'Todos', 'Aberto', 'Iniciado', 'Com Impedimento', 'Concluído', 'Desconsiderado',
    ])
  })
})
