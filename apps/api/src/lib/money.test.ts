import { describe, it, expect } from 'vitest'
import { parseMoney, formatBRL } from './money'

describe('parseMoney', () => {
  it('normalizes dot-decimal amounts to two places', () => {
    expect(parseMoney('1234.56')).toBe('1234.56')
    expect(parseMoney('1234.5')).toBe('1234.50')
    expect(parseMoney('10')).toBe('10.00')
  })

  it('rejects Brazilian format, extra decimals, zero, negative and huge values', () => {
    for (const bad of ['1.234,56', '12,34', '12.345', '-1', '0', '0.00', 'abc', '', '10000000000.00']) {
      expect(() => parseMoney(bad), bad).toThrow('Valor inválido: use até 2 casas decimais')
    }
  })
})

describe('formatBRL', () => {
  it('formats as Brazilian currency', () => {
    expect(formatBRL('1234.56')).toBe('R$ 1.234,56')
    expect(formatBRL('10.00')).toBe('R$ 10,00')
  })
})
