// apps/api/src/modules/document-reader/engine/zonal.test.ts
import { describe, it, expect } from 'vitest'
import { textoDaZona, interpretar } from './zonal'
import type { Pagina, Zona } from './types'

describe('textoDaZona', () => {
  const pagina: Pagina = {
    numero: 1,
    itens: [
      { str: '11.222.333/0001-81', x: 0.06, y: 0.158, w: 0.195, h: 0.01 },
      { str: 'Razão Social Ltda', x: 0.263, y: 0.158, w: 0.3, h: 0.01 }, // fora da zona (x diferente)
    ],
  }
  const zona: Zona = { campo: 'cnpj', pagina: 1, x: 0.06, y: 0.158, w: 0.195, h: 0.01, tipo: 'cnpj' }

  it('lê só o texto cujo centro cai dentro da zona', () => {
    expect(textoDaZona(pagina, zona)).toBe('11.222.333/0001-81')
  })

  it('compensa o deslocamento (dx, dy) do layout', () => {
    const paginaDeslocada: Pagina = {
      numero: 1,
      itens: [{ str: '11.222.333/0001-81', x: 0.08, y: 0.178, w: 0.195, h: 0.01 }],
    }
    expect(textoDaZona(paginaDeslocada, zona, 0.02, 0.02)).toBe('11.222.333/0001-81')
  })

  it('junta múltiplas linhas dentro da mesma zona, de cima pra baixo', () => {
    const zonaAlta: Zona = { campo: 'x', pagina: 1, x: 0, y: 0, w: 1, h: 0.05, tipo: 'texto' }
    const p: Pagina = {
      numero: 1,
      itens: [
        { str: 'linha 2', x: 0, y: 0.03, w: 0.1, h: 0.01 },
        { str: 'linha 1', x: 0, y: 0.01, w: 0.1, h: 0.01 },
      ],
    }
    expect(textoDaZona(p, zonaAlta)).toBe('linha 1\nlinha 2')
  })

  it('devolve string vazia quando nenhum item cai na zona', () => {
    const zonaVazia: Zona = { campo: 'x', pagina: 1, x: 0.8, y: 0.8, w: 0.05, h: 0.01, tipo: 'texto' }
    expect(textoDaZona(pagina, zonaVazia)).toBe('')
  })
})

describe('interpretar', () => {
  it('cnpj: válido', () => {
    expect(interpretar('11.222.333/0001-81', 'cnpj')).toEqual({
      bruto: '11.222.333/0001-81', valor: '11222333000181', valido: true,
    })
  })
  it('data: válida', () => {
    expect(interpretar('20/10/2026', 'data')).toEqual({ bruto: '20/10/2026', valor: '2026-10-20', valido: true })
  })
  it('competencia: válida', () => {
    expect(interpretar('agosto/2026', 'competencia')).toEqual({ bruto: 'agosto/2026', valor: '2026-08', valido: true })
  })
  it('periodo_apuracao: válido', () => {
    expect(interpretar('PA:2º Trimestre/2026', 'periodo_apuracao')).toEqual({
      bruto: 'PA:2º Trimestre/2026', valor: '2026-T2', valido: true,
    })
  })
  it('moeda: válida', () => {
    expect(interpretar('R$ 1.234,56', 'moeda')).toEqual({ bruto: 'R$ 1.234,56', valor: 1234.56, valido: true })
  })
  it('texto: sempre válido se não vazio', () => {
    expect(interpretar('  Qualquer  Texto  ', 'texto')).toEqual({
      bruto: '  Qualquer  Texto  ', valor: 'Qualquer Texto', valido: true,
    })
  })
  it('campo inválido fica com valido=false, mas bruto preservado', () => {
    expect(interpretar('não é uma data', 'data')).toEqual({ bruto: 'não é uma data', valor: null, valido: false })
  })
})
