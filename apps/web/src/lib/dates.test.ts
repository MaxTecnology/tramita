import { describe, it, expect } from 'vitest'
import { utcDateKey } from './dates'

describe('utcDateKey', () => {
  it('retorna a data UTC independente do fuso local do processo', () => {
    // 2026-03-15T00:00:00Z é meia-noite UTC do dia 15 — deve ser '2026-03-15' mesmo que o
    // processo de teste esteja rodando num fuso atrás de UTC (ex.: America/Sao_Paulo, UTC-3,
    // onde new Date(...).getDate() local devolveria 14).
    expect(utcDateKey('2026-03-15T00:00:00.000Z')).toBe('2026-03-15')
  })

  it('preenche mês e dia com zero à esquerda', () => {
    expect(utcDateKey('2026-01-05T00:00:00.000Z')).toBe('2026-01-05')
  })

  it('aceita um objeto Date diretamente', () => {
    expect(utcDateKey(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12-31')
  })
})

describe('formatCompetence', () => {
  it('shows the month and year of a competence (stored as UTC midnight of day 1)', async () => {
    const { formatCompetence } = await import('./dates')
    expect(formatCompetence('2026-03-01T00:00:00.000Z')).toBe('03/2026')
    expect(formatCompetence(new Date(Date.UTC(2025, 11, 1)))).toBe('12/2025')
  })
})
