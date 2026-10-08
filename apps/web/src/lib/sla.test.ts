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
    const now = new Date('2026-10-19T00:00:00Z')
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna TARGET_WARNING dentro da janela de meta', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-18T00:00:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })
})
