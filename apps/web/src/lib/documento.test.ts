import { describe, expect, it } from 'vitest'
import { cnpjValido, cpfValido } from './documento'

describe('documento', () => {
  it('valida dígitos verificadores de CNPJ', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11222333000180')).toBe(false)
    expect(cnpjValido('00000000000000')).toBe(false)
  })

  it('valida dígitos verificadores de CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('11111111111')).toBe(false)
  })
})
