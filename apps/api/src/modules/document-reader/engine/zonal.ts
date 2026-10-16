import type { CampoExtraido, Item, Pagina, Zona } from './types'
import { extrairCnpjOuCpf, parseCompetencia, parseData, parseMoeda, parsePeriodoApuracao } from './validadores'

/** Texto cujos centros caem dentro da zona (com margem de tolerância). Linhas ordenadas de cima p/ baixo. */
export function textoDaZona(pagina: Pagina, z: Zona, dx = 0, dy = 0, margem = 0.004): string {
  const x0 = z.x + dx - margem
  const x1 = z.x + dx + z.w + margem
  const y0 = z.y + dy - margem
  const y1 = z.y + dy + z.h + margem

  const dentro = pagina.itens.filter((i) => {
    const cx = i.x + i.w / 2
    const cy = i.y + i.h / 2
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
  })

  // agrupa em linhas
  dentro.sort((a, b) => a.y - b.y || a.x - b.x)
  const linhas: Item[][] = []
  for (const it of dentro) {
    const ultima = linhas[linhas.length - 1]
    if (ultima && Math.abs(it.y - ultima[0].y) < it.h * 0.6) ultima.push(it)
    else linhas.push([it])
  }
  return linhas
    .map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' '))
    .join('\n')
}

export function interpretar(bruto: string, tipo: Zona['tipo']): CampoExtraido {
  switch (tipo) {
    case 'cnpj': {
      const r = extrairCnpjOuCpf(bruto)
      return { bruto, valor: r?.valor ?? null, valido: !!r?.valido }
    }
    case 'data': {
      const v = parseData(bruto)
      return { bruto, valor: v, valido: v !== null }
    }
    case 'competencia': {
      const v = parseCompetencia(bruto)
      return { bruto, valor: v, valido: v !== null }
    }
    case 'periodo_apuracao': {
      const v = parsePeriodoApuracao(bruto)
      return { bruto, valor: v, valido: v !== null }
    }
    case 'moeda': {
      const v = parseMoeda(bruto)
      return { bruto, valor: v, valido: v !== null }
    }
    default: {
      const v = bruto.replace(/\s+/g, ' ').trim()
      return { bruto, valor: v || null, valido: v.length > 0 }
    }
  }
}
