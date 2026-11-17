import { describe, expect, it } from 'vitest'
import { companyFieldsSchema } from './clients.schema'

const pjAddress = {
  cep: '57312675', estado: 'AL', ibgeCityCode: 2700300, bairro: 'Centro', logradouro: 'Rua A', numero: '10',
}

const validPj = { clientType: 'PJ' as const, codigo: '42', name: 'ACME LTDA', cnpj: '11.222.333/0001-81', ...pjAddress }
const validPf = { clientType: 'PF' as const, codigo: '43', name: 'Fulano', cpf: '529.982.247-25', estado: 'SE', ibgeCityCode: 2800308 }

function firstError(input: unknown): string | undefined {
  const r = companyFieldsSchema.safeParse(input)
  return r.success ? undefined : r.error.errors[0].message
}

describe('companyFieldsSchema', () => {
  it('requires a CNPJ for PJ', () => {
    expect(firstError({ ...validPj, cnpj: undefined })).toBe('Informe o CNPJ')
  })

  it('rejects a PJ CNPJ with invalid check digits', () => {
    expect(firstError({ ...validPj, cnpj: '11222333000180' })).toBe('CNPJ inválido')
  })

  it('requires a CPF for PF', () => {
    expect(firstError({ ...validPf, cpf: undefined })).toBe('Informe o CPF')
  })

  it('rejects a PF CPF with invalid check digits', () => {
    expect(firstError({ ...validPf, cpf: '11111111111' })).toBe('CPF inválido')
  })

  it('requires the client code', () => {
    expect(firstError({ ...validPj, codigo: undefined })).toBe('Informe o código do cliente')
    expect(firstError({ ...validPj, codigo: '   ' })).toBe('Informe o código do cliente')
  })

  it('requires the full address for PJ', () => {
    for (const field of ['cep', 'bairro', 'logradouro', 'numero'] as const) {
      expect(firstError({ ...validPj, [field]: undefined })).toBe('Endereço completo é obrigatório para pessoa jurídica')
    }
  })

  it('requires the state and the city of every client, PF and PJ', () => {
    for (const base of [validPf, validPj]) {
      expect(firstError({ ...base, estado: undefined })).toBe('Informe o estado do cliente')
      expect(firstError({ ...base, estado: '' })).toBe('Informe o estado do cliente')
      expect(firstError({ ...base, ibgeCityCode: undefined })).toBe('Informe a cidade do cliente')
      expect(firstError({ ...base, ibgeCityCode: null })).toBe('Informe a cidade do cliente')
    }
  })

  it('refuses a state that is not one of the 27 UFs', () => {
    expect(firstError({ ...validPf, estado: 'Sergipe' })).toBe('Estado inválido')
    expect(firstError({ ...validPf, estado: 'se' })).toBe('Estado inválido')
  })

  it('accepts a PF with state and city but without the street address', () => {
    expect(companyFieldsSchema.safeParse(validPf).success).toBe(true)
  })

  it('the city name is not taken from the body (it comes from the IBGE table)', () => {
    const r = companyFieldsSchema.safeParse({ ...validPf, cidade: 'Qualquer' })
    expect(r.success && 'cidade' in r.data).toBe(false)
  })

  it('normalizes CNPJ to digits and trims the code', () => {
    const r = companyFieldsSchema.safeParse({ ...validPj, codigo: '  42 ' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.cnpj).toBe('11222333000181')
      expect(r.data.codigo).toBe('42')
    }
  })

  it('normalizes CPF to digits', () => {
    const r = companyFieldsSchema.safeParse(validPf)
    expect(r.success && r.data.cpf).toBe('52998224725')
  })

  it('descarta o documento que não corresponde ao tipo (troca PJ↔PF não deixa CNPJ/CPF antigo gravado)', () => {
    const pf = companyFieldsSchema.parse({ ...validPf, cnpj: '11.222.333/0001-81' })
    expect(pf.cnpj).toBeNull()
    const pjFromPf = companyFieldsSchema.parse({ ...validPj, cpf: '529.982.247-25' })
    expect(pjFromPf.cpf).toBeNull()
  })
})
