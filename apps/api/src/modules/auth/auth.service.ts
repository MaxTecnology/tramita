import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { generateAccessToken } from '@/lib/jwt'
import { AppError } from '@/errors/AppError'
import type { LoginResponse, Role } from '@/modules/auth/auth.types'
import type { UpdateProfileBody } from '@/modules/auth/auth.schema'

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const sessionsKey = (sub: string) => `sessions:${sub}`
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'

export function generateRandomPassword(length = 12): string {
  let password = ''
  for (let i = 0; i < length; i++) {
    password += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]
  }
  return password
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Failed logins per account (besides the per-IP limit of the rate-limit plugin): after the budget the
// account answers 429 until the window passes; a successful login clears it
const LOGIN_WINDOW_SECONDS = 15 * 60
const loginAttemptsKey = (email: string) => `login-attempts:${email.trim().toLowerCase()}`
function loginBudget(): number {
  const value = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 10)
  return Number.isInteger(value) && value > 0 ? value : 10
}
// Compared when the e-mail does not exist, so the answer takes as long as for a real account
const DUMMY_HASH = bcrypt.hashSync('tramita-dummy-password', 10)

export async function login(email: string, password: string): Promise<LoginResponse> {
  const attemptsKey = loginAttemptsKey(email)
  if (Number((await redis.get(attemptsKey)) ?? 0) >= loginBudget()) {
    throw new AppError(429, 'Muitas tentativas de login. Tente de novo em alguns minutos.')
  }
  try {
    const session = await tryLogin(email, password)
    await redis.del(attemptsKey)
    return session
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) {
      const failures = await redis.incr(attemptsKey)
      if (failures === 1) await redis.expire(attemptsKey, LOGIN_WINDOW_SECONDS)
    }
    throw err
  }
}

async function tryLogin(email: string, password: string): Promise<LoginResponse> {
  // Try User table first
  // E-mails are stored in lower case; the comparison ignores case for older rows typed otherwise
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' } },
    include: { organization: { select: { name: true } } },
  })
  // A deactivated staff member keeps the row (history, authorship) but never signs in again
  if (user && (await verifyPassword(password, user.passwordHash)) && user.isActive) {
    return buildSession(user.id, user.name, user.role as Role, user.organizationId, user.organization?.name ?? null)
  }

  // Fall back to ClientUser table (portal login). ClientUser email uniqueness is scoped to
  // (email, organizationId) — not global — so the same email can belong to more than one
  // organization (e.g. a bookkeeper working with multiple accounting offices). Try every
  // candidate and return the session for the first whose password matches.
  const clientUserCandidates = await prisma.clientUser.findMany({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, isActive: true },
    include: { organization: { select: { name: true } } },
  })
  // Nobody with this e-mail: still one password check (same time as a real account)
  if (!user && clientUserCandidates.length === 0) await verifyPassword(password, DUMMY_HASH)
  for (const clientUser of clientUserCandidates) {
    if (await verifyPassword(password, clientUser.passwordHash)) {
      return buildSession(
        clientUser.id,
        clientUser.name,
        'CLIENT',
        clientUser.organizationId,
        clientUser.organization?.name ?? null,
      )
    }
  }

  throw new AppError(401, 'Credenciais inválidas')
}

async function buildSession(
  id: string,
  name: string,
  role: Role,
  organizationId: string | null,
  orgName: string | null,
): Promise<LoginResponse> {
  const accessToken = generateAccessToken({ sub: id, role, organizationId })
  const refreshToken = uuidv4()

  await redis
    .multi()
    .set(`refresh:${refreshToken}`, JSON.stringify({ sub: id, role, organizationId }), 'EX', REFRESH_TTL_SECONDS)
    // Index of the person's sessions, so deactivating, demoting or a new password ends all of them
    .sadd(sessionsKey(id), refreshToken)
    .expire(sessionsKey(id), REFRESH_TTL_SECONDS)
    .exec()

  return { accessToken, refreshToken, user: { id, name, role, organizationId, orgName } }
}

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string }> {
  const stored = await redis.get(`refresh:${refreshToken}`)
  if (!stored) throw new AppError(401, 'Refresh token inválido ou expirado')

  const payload = JSON.parse(stored) as {
    sub: string
    role: Role
    organizationId: string | null
  }

  // A deactivated ClientUser must not be able to keep refreshing access tokens — the
  // access-scope check alone (getClientAccessScope) only closes this gap once the current
  // access token naturally expires, up to 15 minutes later; this closes it immediately for
  // the refresh path, which could otherwise be abused for up to the full 7-day refresh TTL.
  if (payload.role === 'CLIENT') {
    const clientUser = await prisma.clientUser.findUnique({
      where: { id: payload.sub },
      select: { isActive: true },
    })
    if (!clientUser || !clientUser.isActive) {
      throw new AppError(401, 'Refresh token inválido ou expirado')
    }
    return { accessToken: generateAccessToken(payload) }
  }

  // Staff and Master: the token carries what the database says now (a demoted manager does not keep
  // the old role until the session expires) and a deactivated person gets nothing
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { isActive: true, role: true, organizationId: true },
  })
  if (!user || !user.isActive) {
    await revokeSessions(payload.sub)
    throw new AppError(401, 'Refresh token inválido ou expirado')
  }
  return { accessToken: generateAccessToken({ sub: payload.sub, role: user.role as Role, organizationId: user.organizationId }) }
}


// Ends every open session of a person (refresh tokens; an access token already issued lives its
// last minutes). keepRefreshToken: the session the person is using right now, when it is theirs.
export async function revokeSessions(sub: string, keepRefreshToken?: string): Promise<void> {
  const tokens = await redis.smembers(sessionsKey(sub))
  const drop = tokens.filter((t) => t !== keepRefreshToken)
  const tx = redis.multi()
  for (const t of drop) tx.del(`refresh:${t}`)
  if (drop.length > 0) tx.srem(sessionsKey(sub), ...drop)
  await tx.exec()
}

export async function logout(refreshToken: string): Promise<void> {
  const stored = await redis.get(`refresh:${refreshToken}`)
  await redis.del(`refresh:${refreshToken}`)
  if (stored) await redis.srem(sessionsKey((JSON.parse(stored) as { sub: string }).sub), refreshToken)
}

export async function getMyProfile(sub: string, role: string) {
  if (role === 'CLIENT') {
    const clientUser = await prisma.clientUser.findUnique({
      where: { id: sub },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (!clientUser) throw new AppError(404, 'Usuário não encontrado')
    return { ...clientUser, role: 'CLIENT' }
  }
  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: { id: true, name: true, email: true, phone: true, role: true },
  })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
  return user
}

export async function updateMyProfile(sub: string, role: string, data: UpdateProfileBody) {
  if (role === 'CLIENT') {
    const clientUser = await prisma.clientUser.findUnique({ where: { id: sub } })
    if (!clientUser) throw new AppError(404, 'Usuário não encontrado')
    return prisma.clientUser.update({
      where: { id: sub },
      data,
      select: { id: true, name: true, email: true, phone: true },
    })
  }
  const user = await prisma.user.findUnique({ where: { id: sub } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')
  return prisma.user.update({
    where: { id: sub },
    data,
    select: { id: true, name: true, email: true, phone: true, role: true },
  })
}

export async function changePassword(
  sub: string,
  role: string,
  currentPassword: string,
  newPassword: string,
  keepRefreshToken?: string,
): Promise<void> {
  if (role === 'CLIENT') {
    const clientUser = await prisma.clientUser.findUnique({ where: { id: sub } })
    if (!clientUser) throw new AppError(404, 'Usuário não encontrado')
    if (!(await verifyPassword(currentPassword, clientUser.passwordHash))) {
      throw new AppError(400, 'Senha atual incorreta')
    }
    await prisma.clientUser.update({ where: { id: sub }, data: { passwordHash: await hashPassword(newPassword) } })
  } else {
    const user = await prisma.user.findUnique({ where: { id: sub } })
    if (!user) throw new AppError(404, 'Usuário não encontrado')
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AppError(400, 'Senha atual incorreta')
    }
    await prisma.user.update({ where: { id: sub }, data: { passwordHash: await hashPassword(newPassword) } })
  }
  // A new password ends the other sessions (a stolen one included); the current one stays only when
  // the token sent is really this person's
  const kept = keepRefreshToken ? await redis.get(`refresh:${keepRefreshToken}`) : null
  const keep = kept && (JSON.parse(kept) as { sub: string }).sub === sub ? keepRefreshToken : undefined
  await revokeSessions(sub, keep)
}
