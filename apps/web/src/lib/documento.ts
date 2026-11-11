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
