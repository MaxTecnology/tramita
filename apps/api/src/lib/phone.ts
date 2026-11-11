import { AppError } from '@/errors/AppError'

// Formato que o MaximizeBot espera: só dígitos, com DDI 55 (ex.: 5582999991234).
export function normalizarTelefoneBr(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits
  throw new AppError(400, `Telefone inválido: ${input}`)
}
