import { generateKeyPairSync } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { buildApp } from '@/server'

// Generate RS256 key pair for tests — must run before any module reads process.env for JWT
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.JWT_PRIVATE_KEY = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .replace(/\n/g, '\\n')
process.env.JWT_PUBLIC_KEY = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/\n/g, '\\n')

export const app = buildApp()

beforeAll(async () => {
  await redis.connect()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
  await redis.quit()
})

afterEach(async () => {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.taskHistory.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.column.deleteMany(),
    prisma.board.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
    prisma.notificationConfig.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.subscriptionHistory.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.plan.deleteMany(),
  ])
  await redis.flushdb()
})
