import { AppError } from '@/errors/AppError'

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/
const INVALID = 'Valor inválido: use até 2 casas decimais'

// API contract: amounts travel as dot-decimal strings ("1234.56"); the web converts the Brazilian
// format before sending. Never parsed to a float for storage — Prisma stores it as DECIMAL(12,2).
export function parseMoney(input: string): string {
  const value = input.trim()
  if (!MONEY_RE.test(value)) throw new AppError(400, INVALID)
  const [int, dec = ''] = value.split('.')
  const normalized = `${BigInt(int).toString()}.${dec.padEnd(2, '0')}`
  if (/^0\.00$/.test(normalized)) throw new AppError(400, INVALID)
  return normalized
}

export function formatBRL(amount: string | { toString(): string }): string {
  const [int, dec = '00'] = amount.toString().split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${grouped},${dec.padEnd(2, '0').slice(0, 2)}`
}
