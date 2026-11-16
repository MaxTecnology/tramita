import { randomBytes } from 'node:crypto'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { JwtPayload } from '@/lib/jwt'

// EventSource can't send the Authorization header. Instead of the JWT in the URL (which ends up in
// proxy logs, browser history, APM), the client trades its JWT for a random ticket that opens one
// stream connection and expires in 30 seconds: what shows up in a URL is useless afterwards.
const TICKET_TTL_SECONDS = 30
const key = (ticket: string) => `sse-ticket:${ticket}`

export type StreamUser = Pick<JwtPayload, 'sub' | 'role' | 'organizationId'>

export async function issueStreamTicket(user: StreamUser): Promise<string> {
  const ticket = randomBytes(32).toString('base64url')
  const value: StreamUser = { sub: user.sub, role: user.role, organizationId: user.organizationId }
  await redis.set(key(ticket), JSON.stringify(value), 'EX', TICKET_TTL_SECONDS)
  return ticket
}

export async function consumeStreamTicket(ticket: string | undefined): Promise<StreamUser> {
  if (!ticket) throw new AppError(401, 'Ticket não fornecido')
  const stored = await redis.getdel(key(ticket))
  if (!stored) throw new AppError(401, 'Ticket inválido ou expirado')
  return JSON.parse(stored) as StreamUser
}

// The person behind an open stream is still allowed in (deactivated → stream closes on the next check)
export async function stillActive(user: StreamUser): Promise<boolean> {
  if (user.role === 'CLIENT') {
    return (await prisma.clientUser.count({ where: { id: user.sub, isActive: true } })) > 0
  }
  return (await prisma.user.count({ where: { id: user.sub, isActive: true } })) > 0
}

// Re-check for attachSSESubscriber: active, plus whatever access the route checked at connection
export function streamRecheck(user: StreamUser, access?: () => Promise<unknown>): { recheck: () => Promise<boolean> } {
  return {
    recheck: async () => {
      if (!(await stillActive(user))) return false
      if (access) {
        try { await access() } catch { return false }
      }
      return true
    },
  }
}
