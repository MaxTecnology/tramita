import { cnpjValido, cpfValido, soDigitos } from '@/lib/documento'

export { cnpjValido, cpfValido, soDigitos }

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** dd/mm/aaaa -> aaaa-mm-dd (null se inválida) */
export function parseData(s: string): string | null {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const [, dd, mm, aaaa] = m
  const d = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(dd)))
  const ok = d.getUTCFullYear() === Number(aaaa) && d.getUTCMonth() === Number(mm) - 1 && d.getUTCDate() === Number(dd)
  return ok ? `${aaaa}-${mm}-${dd}` : null
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "PA:08/2026", "PA:2º Trimestre/2026" ou "PA:30/09/2026" -> "2026-08", "2026-T2", "2026-09" */
export function parsePeriodoApuracao(s: string): string | null {
  const n = normalizar(s)
  const tri = n.match(/(\d)\s*[ºo°]?\s*trimestre\s*\/\s*(\d{4})/)
  if (tri) return Number(tri[1]) >= 1 && Number(tri[1]) <= 4 ? `${tri[2]}-T${tri[1]}` : null
  const mensal = n.match(/pa:?\s*(\d{2})\/(\d{4})/)
  if (mensal) return Number(mensal[1]) >= 1 && Number(mensal[1]) <= 12 ? `${mensal[2]}-${mensal[1]}` : null
  const dia = n.match(/pa:?\s*(\d{2}\/\d{2}\/\d{4})/)
  return dia ? parseCompetencia(dia[1]) : null
}

/** "09/2026", "30/09/2026" ou "agosto/2026" -> "2026-09" */
export function parseCompetencia(s: string): string | null {
  const porExtenso = normalizar(s).match(/([a-z]+)\s*\/\s*(\d{4})/)
  if (porExtenso) {
    const i = MESES.indexOf(porExtenso[1])
    if (i >= 0) return `${porExtenso[2]}-${String(i + 1).padStart(2, '0')}`
  }
  const completa = s.match(/\d{2}\/(\d{2})\/(\d{4})/)
  if (completa) return parseData(completa[0]) ? `${completa[2]}-${completa[1]}` : null
  const m = s.match(/(\d{2})\/(\d{4})/)
  if (!m) return null
  const mes = Number(m[1])
  return mes >= 1 && mes <= 12 ? `${m[2]}-${m[1]}` : null
}

/** "1.234,56" -> 1234.56 */
// "R$ 1.234,56" → "1234.56": exact decimal string, never through float (money convention).
export function moedaNormalizada(s: string): string | null {
  const m = s.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/)
  if (!m) return null
  return m[0].replace(/\./g, '').replace(',', '.')
}

// Number kept for matching/display in the engine; money that gets stored uses moedaNormalizada.
export function parseMoeda(s: string): number | null {
  const normalizada = moedaNormalizada(s)
  return normalizada === null ? null : Number(normalizada)
}

export function extrairCnpjOuCpf(s: string): { valor: string; valido: boolean } | null {
  const m = s.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)
  if (!m) return null
  const d = soDigitos(m[0])
  return { valor: d, valido: d.length === 14 ? cnpjValido(d) : cpfValido(d) }
}
