// apps/api/src/modules/document-reader/engine/ancoras.test.ts
import { describe, it, expect } from 'vitest'
import { localizar, pontuarModelos, detalharAncoras } from './ancoras'
import type { Pagina, Modelo } from './types'

function pagina(itens: Pagina['itens']): Pagina {
  return { numero: 1, itens }
}

describe('localizar', () => {
  it('prefere correspondência exata sobre "contém"', () => {
    const p = pagina([
      { str: 'Documento de Arrecadação', x: 0.1, y: 0.1, w: 0.2, h: 0.01 },
      { str: 'Composição do Documento de Arrecadação', x: 0.1, y: 0.5, w: 0.3, h: 0.01 },
    ])
    const achado = localizar(p, { texto: 'Documento de Arrecadação', pagina: 1 })
    expect(achado?.y).toBe(0.1)
  })

  it('entre vários candidatos "contém", escolhe o mais próximo da posição do modelo', () => {
    const p = pagina([
      { str: 'Documento de Arrecadação (cabeçalho)', x: 0.1, y: 0.06, w: 0.3, h: 0.01 },
      { str: 'Documento de Arrecadação (rodapé)', x: 0.1, y: 0.9, w: 0.3, h: 0.01 },
    ])
    const achado = localizar(p, { texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.08 })
    expect(achado?.y).toBe(0.06)
  })

  it('devolve undefined se a âncora não existe na página', () => {
    const p = pagina([{ str: 'Outro texto qualquer', x: 0, y: 0, w: 0.1, h: 0.01 }])
    expect(localizar(p, { texto: 'Documento de Arrecadação', pagina: 1 })).toBeUndefined()
  })
})

describe('pontuarModelos', () => {
  const modelo: Modelo = {
    id: 'm1',
    nome: 'Modelo 1',
    tipoImposto: 'DARF',
    ancoras: [
      { texto: 'Âncora A', pagina: 1, x: 0.1, y: 0.1 },
      { texto: 'Âncora B', pagina: 1, x: 0.5, y: 0.5 },
    ],
    zonas: [],
  }

  it('score 1 quando todas as âncoras são encontradas', () => {
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.5, y: 0.5, w: 0.1, h: 0.01 },
    ])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.scoreAncoras).toBe(1)
  })

  it('score 0.5 quando só metade das âncoras é encontrada', () => {
    const paginas = [pagina([{ str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 }])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.scoreAncoras).toBe(0.5)
  })

  it('calcula o deslocamento (dx, dy) do layout', () => {
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.15, y: 0.12, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.55, y: 0.52, w: 0.1, h: 0.01 },
    ])]
    const [r] = pontuarModelos(paginas, [modelo])
    expect(r.dx).toBeCloseTo(0.05, 5)
    expect(r.dy).toBeCloseTo(0.02, 5)
  })

  it('ordena por score decrescente', () => {
    const modeloFraco: Modelo = { ...modelo, id: 'm2', ancoras: [{ texto: 'Não existe', pagina: 1 }] }
    const paginas = [pagina([
      { str: 'Âncora A', x: 0.1, y: 0.1, w: 0.1, h: 0.01 },
      { str: 'Âncora B', x: 0.5, y: 0.5, w: 0.1, h: 0.01 },
    ])]
    const [primeiro, segundo] = pontuarModelos(paginas, [modeloFraco, modelo])
    expect(primeiro.modelo.id).toBe('m1')
    expect(segundo.modelo.id).toBe('m2')
  })
})

describe('detalharAncoras', () => {
  it('reporta cada âncora como achada ou não', () => {
    const modelo: Modelo = {
      id: 'm1', nome: 'M', tipoImposto: 'DARF',
      ancoras: [{ texto: 'Existe', pagina: 1 }, { texto: 'Não existe', pagina: 1 }],
      zonas: [],
    }
    const paginas = [pagina([{ str: 'Existe', x: 0, y: 0, w: 0.1, h: 0.01 }])]
    const detalhe = detalharAncoras(paginas, modelo)
    expect(detalhe).toEqual([
      { texto: 'Existe', pagina: 1, achada: true, x: 0, y: 0 },
      { texto: 'Não existe', pagina: 1, achada: false, x: undefined, y: undefined },
    ])
  })
})
