import { describe, it, expect } from 'vitest'
import { toApiAmount, formatBRL, toInputAmount } from './money'

describe('toApiAmount', () => {
  it('converts the Brazilian format typed by the user to the API dot-decimal string', () => {
    expect(toApiAmount('1.234,56')).toBe('1234.56')
    expect(toApiAmount('1234,5')).toBe('1234.50')
    expect(toApiAmount('10')).toBe('10.00')
    expect(toApiAmount(' R$ 83,60 ')).toBe('83.60')
  })

  it('throws on invalid input', () => {
    for (const bad of ['12,345', 'abc', '', '0', '0,00', '-5']) {
      expect(() => toApiAmount(bad), bad).toThrow('Valor inválido')
    }
  })
})

describe('formatBRL / toInputAmount', () => {
  it('formats API amounts for display and for an editable input', () => {
    expect(formatBRL('1234.56')).toBe('R$ 1.234,56')
    expect(formatBRL('10')).toBe('R$ 10,00')
    expect(toInputAmount('1234.5')).toBe('1.234,50')
  })
})
