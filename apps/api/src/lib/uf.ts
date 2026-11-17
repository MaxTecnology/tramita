import { z } from 'zod'

// Brazil's 27 federative units
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

export type UF = (typeof UFS)[number]

export const ufSchema = z.enum(UFS, { errorMap: () => ({ message: 'Estado inválido' }) })

export function isUf(value: string | null | undefined): value is UF {
  return !!value && (UFS as readonly string[]).includes(value)
}
