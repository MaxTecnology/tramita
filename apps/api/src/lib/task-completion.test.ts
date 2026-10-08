import { describe, it, expect } from 'vitest'
import { resolveCompletedAt } from './task-completion'

describe('resolveCompletedAt', () => {
  it('retorna a data atual quando a tarefa acabou de ficar DONE', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('OPEN', 'DONE', now)).toEqual(now)
  })

  it('retorna null quando a tarefa sai de DONE pra qualquer outro status (reaberta)', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('DONE', 'OPEN', now)).toBeNull()
    expect(resolveCompletedAt('DONE', 'STARTED', now)).toBeNull()
  })

  it('retorna undefined quando não há mudança de status relevante pra completedAt', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('OPEN', 'STARTED', now)).toBeUndefined()
    expect(resolveCompletedAt('OPEN', 'BLOCKED', now)).toBeUndefined()
    expect(resolveCompletedAt('BLOCKED', 'OPEN', now)).toBeUndefined()
  })

  it('retorna undefined quando o status não mudou de fato', () => {
    const now = new Date('2026-10-08T12:00:00Z')
    expect(resolveCompletedAt('DONE', 'DONE', now)).toBeUndefined()
    expect(resolveCompletedAt('OPEN', 'OPEN', now)).toBeUndefined()
  })
})
