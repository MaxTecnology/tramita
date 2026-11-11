import { describe, expect, it } from 'vitest'
import { cnpjValido, cpfValido, soDigitos } from './documento'

describe('documento', () => {
  it('accepts a CNPJ with valid check digits, masked or not', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11222333000181')).toBe(true)
  })

  it('rejects a CNPJ with wrong check digits or repeated digits', () => {
    expect(cnpjValido('11222333000180')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
  })

  it('validates CPF check digits', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('11111111111')).toBe(false)
  })

  it('strips everything but digits', () => {
    expect(soDigitos('12.345-6')).toBe('123456')
  })
})
