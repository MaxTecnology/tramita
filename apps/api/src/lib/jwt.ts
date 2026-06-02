import jwt from 'jsonwebtoken'
import type { Role } from '@/modules/auth/auth.types'

export interface JwtPayload {
  sub: string
  role: Role
  organizationId: string | null
  iat?: number
  exp?: number
}

function privateKey(): string {
  return (process.env.JWT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
}

function publicKey(): string {
  return (process.env.JWT_PUBLIC_KEY ?? '').replace(/\\n/g, '\n')
}

export function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, privateKey(), { algorithm: 'RS256', expiresIn: '15m' })
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, publicKey(), { algorithms: ['RS256'] }) as JwtPayload
}
