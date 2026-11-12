// The API takes amounts as dot-decimal strings ("1234.56"); people type the Brazilian format
// ("1.234,56"). Conversion happens here, never with floats.
const BR_RE = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/

export function toApiAmount(input: string): string {
  const value = input.replace(/R\$\s*/i, '').trim()
  if (!BR_RE.test(value)) throw new Error('Valor inválido')
  const [int, dec = ''] = value.replace(/\./g, '').split(',')
  const normalized = `${BigInt(int).toString()}.${dec.padEnd(2, '0')}`
  if (normalized === '0.00') throw new Error('Valor inválido')
  return normalized
}

function split(amount: string): [string, string] {
  const [int, dec = ''] = amount.split('.')
  return [int.replace(/\B(?=(\d{3})+(?!\d))/g, '.'), dec.padEnd(2, '0').slice(0, 2)]
}

export function formatBRL(amount: string): string {
  const [int, dec] = split(amount)
  return `R$ ${int},${dec}`
}

// API amount → value to pre-fill an input the user can edit ("1.234,50")
export function toInputAmount(amount: string): string {
  const [int, dec] = split(amount)
  return `${int},${dec}`
}
