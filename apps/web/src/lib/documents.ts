export const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')

// CNPJ 00.000.000/0000-00 and CPF 000.000.000-00; anything else (incomplete, already formatted
// with other digits count) is shown as stored
export function formatDocument(value: string | null | undefined): string {
  const d = digitsOf(value)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return value ?? ''
}
