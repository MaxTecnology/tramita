import jwt from 'jsonwebtoken'
import type { Role } from '@/modules/auth/auth.types'

export interface JwtPayload {
  sub: string
  role: Role
  organizationId: string | null
  iat?: number
  exp?: number
}

// Aceita dois formatos para acomodar plataformas de deploy cujo gerador de
// .env desfaz o escape "\n" dentro de aspas duplas (ex: Dokploy), quebrando
// o formato antigo de uma linha com "\n" literal:
//   1. PEM já decodificado (linhas reais, ou uma linha com "\n" literal)
//   2. PEM inteiro codificado em base64 (sem nenhuma quebra/escape em jogo)
function decodeKey(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('-----BEGIN')) return value.replace(/\\n/g, '\n')
  return Buffer.from(value, 'base64').toString('utf8')
}

function privateKey(): string {
  return decodeKey(process.env.JWT_PRIVATE_KEY ?? '')
}

function publicKey(): string {
  return decodeKey(process.env.JWT_PUBLIC_KEY ?? '')
}

export function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, privateKey(), { algorithm: 'RS256', expiresIn: '15m' })
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, publicKey(), { algorithms: ['RS256'] }) as JwtPayload
}
