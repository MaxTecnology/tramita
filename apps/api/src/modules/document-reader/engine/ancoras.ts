import type { Ancora, Modelo, Pagina, ResultadoModelo } from './types'
import { normalizar } from './validadores'

/**
 * Procura o texto da âncora em um único trecho do PDF.
 * - Prefere correspondência exata (o texto do trecho é igual à âncora); só depois "contém".
 *   Ex.: "Documento de Arrecadação" aparece no cabeçalho e também dentro do rodapé.
 * - Havendo vários candidatos, escolhe o mais próximo da posição que a âncora tinha no PDF modelo.
 * (Limitação do POC: âncora que o pdf.js quebre em vários itens não é encontrada.)
 */
export function localizar(pagina: Pagina | undefined, a: Ancora) {
  if (!pagina) return undefined
  const alvo = normalizar(a.texto)
  const exatos = pagina.itens.filter((i) => normalizar(i.str) === alvo)
  const candidatos = exatos.length ? exatos : pagina.itens.filter((i) => normalizar(i.str).includes(alvo))
  if (!candidatos.length) return undefined
  if (a.x === undefined || a.y === undefined) return candidatos[0]
  const dist = (i: { x: number; y: number }) => Math.hypot(i.x - a.x!, i.y - a.y!)
  return candidatos.reduce((melhor, i) => (dist(i) < dist(melhor) ? i : melhor))
}

/** Pontua todos os modelos contra o documento; maior score primeiro. */
export function pontuarModelos(paginas: Pagina[], modelos: Modelo[]): ResultadoModelo[] {
  const resultados = modelos.map((modelo) => {
    let achadas = 0
    let somaDx = 0
    let somaDy = 0
    let comPosicao = 0

    for (const a of modelo.ancoras) {
      const item = localizar(paginas[a.pagina - 1], a)
      if (!item) continue
      achadas++
      if (a.x !== undefined && a.y !== undefined) {
        somaDx += item.x - a.x
        somaDy += item.y - a.y
        comPosicao++
      }
    }

    return {
      modelo,
      scoreAncoras: modelo.ancoras.length ? achadas / modelo.ancoras.length : 0,
      // deslocamento do layout: média da diferença entre onde a âncora está e onde estava no modelo
      dx: comPosicao ? somaDx / comPosicao : 0,
      dy: comPosicao ? somaDy / comPosicao : 0,
    }
  })

  return resultados.sort((a, b) => b.scoreAncoras - a.scoreAncoras)
}

/** Situação de cada âncora do modelo no documento (achada ou não) e onde foi achada. */
export function detalharAncoras(paginas: Pagina[], modelo: Modelo) {
  return modelo.ancoras.map((a) => {
    const item = localizar(paginas[a.pagina - 1], a)
    return { texto: a.texto, pagina: a.pagina, achada: !!item, x: item?.x, y: item?.y }
  })
}
