import { describe, expect, it } from 'vitest'
import { normalizarTelefoneBr } from './phone'

describe('normalizarTelefoneBr', () => {
  it('adds the 55 country code to a masked DDD + number', () => {
    expect(normalizarTelefoneBr('(82) 99999-1234')).toBe('5582999991234')
    expect(normalizarTelefoneBr('82 3333-1234')).toBe('558233331234')
  })

  it('keeps a number that already has the 55 country code', () => {
    expect(normalizarTelefoneBr('5582999991234')).toBe('5582999991234')
    expect(normalizarTelefoneBr('+55 (82) 3333-1234')).toBe('558233331234')
  })

  it('rejects a number that is too short or too long', () => {
    expect(() => normalizarTelefoneBr('1234')).toThrow('Telefone inválido: 1234')
    expect(() => normalizarTelefoneBr('99999999999999')).toThrow()
  })
})
