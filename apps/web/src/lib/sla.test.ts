import { describe, it, expect } from 'vitest'
import { computeSlaLevel, type SlaConfig } from './sla'

const config: SlaConfig = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

describe('computeSlaLevel (frontend mirror)', () => {
  it('retorna NONE sem datas', () => {
    expect(computeSlaLevel(null, null, new Date(), config)).toBe('NONE')
  })

  it('prioriza DUE_CRITICAL sobre TARGET_WARNING', () => {
    const targetDate = new Date('2026-10-15T00:00:00Z')
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T15:00:00Z')
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna TARGET_WARNING dentro da janela de meta', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-18T15:00:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })

  it('não dispara TARGET_WARNING ~3h adiantado por causa do fuso (mesmo bug corrigido no backend)', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    // 2026-10-17T01:30Z = 2026-10-16T22:30 BRT — ainda dia 16, 4 dias antes do alvo, fora da
    // janela de 3. A comparação antiga por instante bruto já tinha passado do threshold
    // (2026-10-17T00:00:00Z) e disparava TARGET_WARNING aqui, 3h antes do dia 17 começar em BRT.
    const now = new Date('2026-10-17T01:30:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('NONE')
  })
})
