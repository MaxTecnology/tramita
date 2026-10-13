import { describe, it, expect } from 'vitest'
import { computeSlaLevel, type SlaConfig } from './sla'

const config: SlaConfig = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

// targetDate/dueDate são rótulos de dia-calendário (meia-noite UTC), não instantes reais — `now`
// abaixo usa horários reais do dia (não meia-noite UTC) pra que os testes reflitam o uso real
// (polling do frontend, cron do digest), não o caso degenerado onde `now` também é meia-noite UTC
// e mascara o bug de fuso (ver commit que corrigiu isso).
describe('computeSlaLevel', () => {
  it('retorna NONE quando não há targetDate nem dueDate', () => {
    expect(computeSlaLevel(null, null, new Date('2026-10-08T12:00:00Z'), config)).toBe('NONE')
  })

  it('retorna NONE quando a data de referência ainda está fora da janela de aviso', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-10T12:00:00Z') // 10 dias antes (BRT), janela é 3
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('NONE')
  })

  it('retorna TARGET_WARNING ao cruzar a janela de aviso da meta (dia-calendário BRT, não instante bruto)', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    // 2026-10-17T15:00Z = 12h BRT do dia 17 — exatamente 3 dias antes em BRT. Com a comparação
    // antiga (instante bruto), 2026-10-17T15:00Z já é bem depois de subtractDaysUTC(target, 3) =
    // 2026-10-17T00:00Z, então o teste "passava" por coincidência; o bug real aparecia pouco
    // antes da meia-noite UTC do dia-calendário certo (ver teste "não dispara 3h adiantado" abaixo).
    const now = new Date('2026-10-17T15:00:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })

  it('não dispara TARGET_WARNING ~3h adiantado por causa do fuso (o bug que corrigimos)', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    // 2026-10-17T01:30Z = 2026-10-16T22:30 BRT — ainda é dia 16 em BRT, 4 dias antes do alvo,
    // fora da janela de 3. A comparação antiga por instante bruto (now >= subtractDaysUTC(target,
    // 3) = 2026-10-17T00:00:00Z) já tinha passado (01:30 > 00:00) e disparava TARGET_WARNING aqui
    // — 3h adiantado, antes até do dia 17 começar em BRT (que só começa às 2026-10-17T03:00Z).
    const now = new Date('2026-10-17T01:30:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('NONE')
  })

  it('retorna DUE_CRITICAL ao cruzar a janela crítica do vencimento', () => {
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T15:00:00Z') // meio-dia BRT do dia 19, 1 dia antes
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('prioriza DUE_CRITICAL quando ambos os níveis se aplicam ao mesmo tempo', () => {
    const targetDate = new Date('2026-10-15T00:00:00Z')
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T15:00:00Z') // já passou a meta (warning) e está crítico
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna DUE_CRITICAL mesmo depois do vencimento ter passado (tarefa atrasada)', () => {
    const dueDate = new Date('2026-10-01T00:00:00Z')
    const now = new Date('2026-10-08T15:00:00Z')
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('respeita thresholds customizados por organização', () => {
    const custom: SlaConfig = { slaTargetWarningDays: 10, slaDueCriticalDays: 5 }
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-11T15:00:00Z') // 9 dias antes (BRT), dentro da janela de 10
    expect(computeSlaLevel(targetDate, null, now, custom)).toBe('TARGET_WARNING')
  })
})
