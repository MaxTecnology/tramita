// Brazil's 27 federative units (same list the API accepts)
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

export type UF = (typeof UFS)[number]

export function isUf(value: string | null | undefined): value is UF {
  return !!value && (UFS as readonly string[]).includes(value)
}
