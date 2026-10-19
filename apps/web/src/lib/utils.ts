import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function mensagemDeErro(err: unknown, padrao: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? padrao
}
