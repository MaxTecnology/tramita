import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { generateAccessToken } from '@/lib/jwt'
import { AppError } from '@/errors/AppError'
import type { LoginResponse, Role } from '@/modules/auth/auth.types'

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  // Try User table first
  const user = await prisma.user.findUnique({ where: { email } })
  if (user && (await verifyPassword(password, user.passwordHash))) {
    return buildSession(user.id, user.name, user.role as Role, user.organizationId)
  }

  // Fall back to Client table
  const client = await prisma.client.findFirst({ where: { email } })
  if (client && (await verifyPassword(password, client.passwordHash))) {
    return buildSession(client.id, client.name, 'CLIENT', client.organizationId)
  }

  throw new AppError(401, 'Credenciais inválidas')
}

async function buildSession(
  id: string,
  name: string,
  role: Role,
  organizationId: string,
): Promise<LoginResponse> {
  const accessToken = generateAccessToken({ sub: id, role, organizationId })
  const refreshToken = uuidv4()

  await redis.set(
    `refresh:${refreshToken}`,
    JSON.stringify({ sub: id, role, organizationId }),
    'EX',
    REFRESH_TTL_SECONDS,
  )

  return { accessToken, refreshToken, user: { id, name, role, organizationId } }
}

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string }> {
  const stored = await redis.get(`refresh:${refreshToken}`)
  if (!stored) throw new AppError(401, 'Refresh token inválido ou expirado')

  const payload = JSON.parse(stored) as {
    sub: string
    role: Role
    organizationId: string
  }
  const accessToken = generateAccessToken(payload)
  return { accessToken }
}

export async function logout(refreshToken: string): Promise<void> {
  await redis.del(`refresh:${refreshToken}`)
}
