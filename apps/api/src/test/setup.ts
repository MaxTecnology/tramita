import { generateKeyPairSync } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { buildApp } from '@/server'

// 32 bytes of zeros in hex — test-only encryption key
process.env.ENCRYPTION_KEY = '0'.repeat(64)

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
  // Redis uses lazyConnect: true, so we skip explicit connect in tests
  // This avoids requiring a running Redis server for unit tests
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
  // Redis never connected in tests (lazyConnect: true), so skip quit
})

afterEach(async () => {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.requestAttachment.deleteMany(),
    prisma.request.deleteMany(),
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
  // Redis never connected in tests (lazyConnect: true), so skip flushdb
})
