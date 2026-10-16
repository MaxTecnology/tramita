// apps/api/src/modules/document-reader/engine/validadores.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalizar, soDigitos, cnpjValido, cpfValido, parseData,
  parsePeriodoApuracao, parseCompetencia, parseMoeda, extrairCnpjOuCpf,
} from './validadores'

describe('normalizar', () => {
  it('remove acento, baixa caixa e espaço duplicado', () => {
    expect(normalizar('  Documento de  Arrecadação  ')).toBe('documento de arrecadacao')
  })
})

describe('cnpjValido', () => {
  it('aceita CNPJ com dígito verificador correto', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
  })
  it('rejeita CNPJ com dígito verificador errado', () => {
    expect(cnpjValido('11.222.333/0001-82')).toBe(false)
  })
  it('rejeita sequência de dígitos repetidos', () => {
    expect(cnpjValido('11.111.111/1111-11')).toBe(false)
  })
})

describe('cpfValido', () => {
  it('aceita CPF com dígito verificador correto', () => {
    expect(cpfValido('111.444.777-35')).toBe(true)
  })
  it('rejeita CPF com dígito verificador errado', () => {
    expect(cpfValido('111.444.777-36')).toBe(false)
  })
})

describe('parseData', () => {
  it('converte dd/mm/aaaa pra aaaa-mm-dd', () => {
    expect(parseData('20/10/2026')).toBe('2026-10-20')
  })
  it('rejeita data que não existe (31 de fevereiro)', () => {
    expect(parseData('31/02/2026')).toBeNull()
  })
})

describe('parseCompetencia', () => {
  it('lê mês por extenso', () => {
    expect(parseCompetencia('agosto/2026')).toBe('2026-08')
  })
  it('lê mm/aaaa', () => {
    expect(parseCompetencia('08/2026')).toBe('2026-08')
  })
  it('lê dd/mm/aaaa e deriva o mês', () => {
    expect(parseCompetencia('15/08/2026')).toBe('2026-08')
  })
})

describe('parsePeriodoApuracao', () => {
  it('lê trimestre', () => {
    expect(parsePeriodoApuracao('PA:2º Trimestre/2026')).toBe('2026-T2')
  })
  it('lê mês', () => {
    expect(parsePeriodoApuracao('PA:08/2026')).toBe('2026-08')
  })
})

describe('parseMoeda', () => {
  it('lê valor com separador de milhar', () => {
    expect(parseMoeda('R$ 1.234,56')).toBe(1234.56)
  })
})

describe('extrairCnpjOuCpf', () => {
  it('reconhece CNPJ válido dentro de texto', () => {
    const r = extrairCnpjOuCpf('CNPJ: 11.222.333/0001-81')
    expect(r).toEqual({ valor: '11222333000181', valido: true })
  })
  it('reconhece CNPJ inválido mas ainda extrai o valor (confiança cai depois, não aqui)', () => {
    const r = extrairCnpjOuCpf('CNPJ: 11.222.333/0001-82')
    expect(r).toEqual({ valor: '11222333000182', valido: false })
  })
})
