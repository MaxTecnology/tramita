export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function soDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

export function cnpjValido(entrada: string): boolean {
  const c = soDigitos(entrada)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(c.slice(0, 12))
  const d2 = dv(c.slice(0, 12) + d1)
  return c.endsWith(`${d1}${d2}`)
}

export function cpfValido(entrada: string): boolean {
  const c = soDigitos(entrada)
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false
  const dv = (base: string) => {
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * (base.length + 1 - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(c.slice(0, 9))
  const d2 = dv(c.slice(0, 9) + d1)
  return c.endsWith(`${d1}${d2}`)
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
export function parseMoeda(s: string): number | null {
  const m = s.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/)
  if (!m) return null
  return Number(m[0].replace(/\./g, '').replace(',', '.'))
}

export function extrairCnpjOuCpf(s: string): { valor: string; valido: boolean } | null {
  const m = s.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)
  if (!m) return null
  const d = soDigitos(m[0])
  return { valor: d, valido: d.length === 14 ? cnpjValido(d) : cpfValido(d) }
}
