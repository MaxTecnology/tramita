import { describe, it, expect } from 'vitest'
import { computeSlaLevel, type SlaConfig } from './sla'

const config: SlaConfig = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

describe('computeSlaLevel', () => {
  it('retorna NONE quando não há targetDate nem dueDate', () => {
    expect(computeSlaLevel(null, null, new Date('2026-10-08'), config)).toBe('NONE')
  })

  it('retorna NONE quando a data de referência ainda está fora da janela de aviso', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-10T00:00:00Z') // 10 dias antes, janela é 3
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('NONE')
  })

  it('retorna TARGET_WARNING ao cruzar a janela de aviso da meta', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-17T00:00:00Z') // exatamente 3 dias antes
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })

  it('retorna DUE_CRITICAL ao cruzar a janela crítica do vencimento', () => {
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T00:00:00Z') // 1 dia antes
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('prioriza DUE_CRITICAL quando ambos os níveis se aplicam ao mesmo tempo', () => {
    const targetDate = new Date('2026-10-15T00:00:00Z')
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T00:00:00Z') // já passou a meta (warning) e está crítico
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna DUE_CRITICAL mesmo depois do vencimento ter passado (tarefa atrasada)', () => {
    const dueDate = new Date('2026-10-01T00:00:00Z')
    const now = new Date('2026-10-08T00:00:00Z')
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('respeita thresholds customizados por organização', () => {
    const custom: SlaConfig = { slaTargetWarningDays: 10, slaDueCriticalDays: 5 }
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-11T00:00:00Z') // 9 dias antes, dentro da janela de 10
    expect(computeSlaLevel(targetDate, null, now, custom)).toBe('TARGET_WARNING')
  })
})
