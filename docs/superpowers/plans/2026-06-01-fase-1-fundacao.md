# Fase 1 — Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Tramita monorepo with a working Fastify API, full Prisma schema, JWT RS256 auth (login/refresh/logout), tenant middlewares, health endpoint, and seed data — all covered by Vitest tests.

**Architecture:** pnpm monorepo (`apps/api` + `apps/web`). The API uses Fastify v5 with TypeScript strict. Auth uses `jsonwebtoken` for RS256 sign/verify; refresh tokens are UUID strings stored in Redis with 7-day TTL. All Fastify plugins are registered lazily so test setup can set `process.env` before `app.ready()` runs.

**Tech Stack:** Node 20 + TypeScript strict, Fastify v5, Prisma v6, PostgreSQL, Redis (ioredis), BullMQ, bcryptjs, jsonwebtoken, Zod, Vitest.

---

## File Map

```
tramita/
├── pnpm-workspace.yaml
├── package.json                         # root (private, scripts only)
├── tsconfig.base.json
├── .gitignore
├── .env.example
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma            # complete schema from SCHEMA.md
│   │   │   └── seed.ts                 # Starter/Pro/Enterprise plans + MASTER user
│   │   └── src/
│   │       ├── app.ts                  # entry point — calls buildApp().listen()
│   │       ├── server.ts               # buildApp() factory (used in tests)
│   │       ├── errors/
│   │       │   └── AppError.ts
│   │       ├── lib/
│   │       │   ├── prisma.ts           # singleton PrismaClient
│   │       │   ├── redis.ts            # singleton ioredis client
│   │       │   └── jwt.ts              # sign/verify RS256 access + refresh helpers
│   │       ├── plugins/
│   │       │   ├── jwt.ts              # fastify-level JWT plugin (registers @fastify/jwt)
│   │       │   ├── cors.ts
│   │       │   └── rate-limit.ts
│   │       ├── middlewares/
│   │       │   ├── verifyJWT.ts
│   │       │   ├── requireRole.ts
│   │       │   ├── verifyOrg.ts
│   │       │   ├── checkSubscription.ts
│   │       │   └── checkPlanLimit.ts
│   │       ├── types/
│   │       │   └── fastify.d.ts        # augments FastifyRequest with .user
│   │       ├── modules/
│   │       │   └── auth/
│   │       │       ├── auth.schema.ts
│   │       │       ├── auth.types.ts
│   │       │       ├── auth.service.ts
│   │       │       ├── auth.routes.ts
│   │       │       ├── auth.service.test.ts
│   │       │       └── auth.routes.test.ts
│   │       └── test/
│   │           ├── setup.ts            # global test setup (env vars, app, DB cleanup)
│   │           └── helpers.ts          # createTestUser(), createTestOrg(), loginAs()
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           └── App.tsx
```

---

## Task 1: Monorepo foundation

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "tramita",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "test:api": "pnpm --filter api test",
    "test:web": "pnpm --filter web test"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=10"
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
.env.local
*.pem
coverage/
.prisma/
```

- [ ] **Step 5: Create .env.example**

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tramita
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/tramita_test

# Redis
REDIS_URL=redis://localhost:6379

# JWT (RS256 PEM — use \n as line separator in single-line format)
JWT_PRIVATE_KEY=<run: openssl genrsa 2048 | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0}'>
JWT_PUBLIC_KEY=<run: openssl rsa -pubout -in private.pem | awk 'NF {sub(/\r/, ""); printf "%s\\n",$0}'>

# Asaas
ASAAS_API_KEY=
ASAAS_BASE_URL=https://api.asaas.com/v3
ASAAS_WEBHOOK_SECRET=

# Backblaze B2
B2_KEY_ID=
B2_APP_KEY=
B2_BUCKET_NAME=tramita
B2_BUCKET_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com

# App
PORT=3000
NODE_ENV=development
APP_URL=https://tramita.autohubs.com.br

# Encryption (32-byte hex for AES-256)
ENCRYPTION_KEY=
```

- [ ] **Step 6: Commit**

```bash
git init
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore .env.example
git commit -m "chore: monorepo foundation"
```

---

## Task 2: API package setup

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`

- [ ] **Step 1: Create apps/api/package.json**

```json
{
  "name": "api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "prisma": "prisma"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.2",
    "@fastify/rate-limit": "^10.3.0",
    "@prisma/client": "^6.9.0",
    "bcryptjs": "^2.4.3",
    "bullmq": "^5.56.0",
    "fastify": "^5.3.0",
    "ioredis": "^5.6.0",
    "jsonwebtoken": "^9.0.2",
    "pino": "^9.7.0",
    "uuid": "^11.1.0",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.9",
    "@types/node": "^22.15.29",
    "@vitest/coverage-v8": "^3.2.3",
    "prisma": "^6.9.0",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "vite-tsconfig-paths": "^5.1.4",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create apps/api/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**', 'src/lib/**'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
```

- [ ] **Step 4: Install dependencies**

```bash
cd apps/api && pnpm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/vitest.config.ts
git commit -m "chore: API package setup with Vitest"
```

---

## Task 3: Error handling

**Files:**
- Create: `apps/api/src/errors/AppError.ts`

- [ ] **Step 1: Create AppError**

```typescript
// apps/api/src/errors/AppError.ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
```

---

## Task 4: Prisma schema + migration

**Files:**
- Create: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Create prisma/schema.prisma** (full schema from SCHEMA.md)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Plan {
  id           String   @id @default(cuid())
  name         String
  maxClients   Int
  priceMonthly Decimal  @db.Decimal(10, 2)
  features     Json
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  organizations Organization[]

  @@map("plans")
}

model Organization {
  id                  String             @id @default(cuid())
  name                String
  slug                String             @unique
  cnpj                String?            @unique
  email               String             @unique
  phone               String?
  planId              String
  subscriptionStatus  SubscriptionStatus @default(TRIAL)
  trialEndsAt         DateTime?
  gracePeriodEndsAt   DateTime?
  asaasCustomerId     String?
  asaasSubscriptionId String?
  isActive            Boolean            @default(true)
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  plan                Plan                  @relation(fields: [planId], references: [id])
  users               User[]
  clients             Client[]
  boards              Board[]
  notificationConfig  NotificationConfig?
  messageTemplates    MessageTemplate[]
  notificationLogs    NotificationLog[]
  subscriptionHistory SubscriptionHistory[]

  @@map("organizations")
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  GRACE_PERIOD
  SUSPENDED
  CANCELLED
}

model SubscriptionHistory {
  id             String   @id @default(cuid())
  organizationId String
  event          String
  planId         String?
  amount         Decimal? @db.Decimal(10, 2)
  asaasPaymentId String?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("subscription_history")
}

model User {
  id             String   @id @default(cuid())
  name           String
  email          String   @unique
  passwordHash   String
  role           UserRole @default(ORG_MEMBER)
  phone          String?
  organizationId String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization  Organization @relation(fields: [organizationId], references: [id])
  assignedTasks Task[]       @relation("TaskAssignee")
  createdTasks  Task[]       @relation("TaskCreator")
  comments      Comment[]
  attachments   Attachment[]

  @@map("users")
}

enum UserRole {
  MASTER
  ORG_ADMIN
  ORG_MANAGER
  ORG_MEMBER
}

model Client {
  id             String   @id @default(cuid())
  name           String
  cnpj           String?
  email          String
  passwordHash   String
  whatsapp       String?
  organizationId String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  boards       Board[]
  comments     Comment[]

  @@unique([email, organizationId])
  @@map("clients")
}

model Board {
  id             String   @id @default(cuid())
  title          String
  description    String?
  organizationId String
  clientId       String
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  client       Client       @relation(fields: [clientId], references: [id])
  columns      Column[]

  @@map("boards")
}

model Column {
  id        String   @id @default(cuid())
  title     String
  position  Int
  color     String?
  isFinal   Boolean  @default(false)
  boardId   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  board Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@map("columns")
}

model Task {
  id          String     @id @default(cuid())
  title       String
  description String?
  position    Int
  priority    Priority   @default(MEDIUM)
  status      TaskStatus @default(OPEN)
  dueDate     DateTime?
  columnId    String
  assigneeId  String?
  creatorId   String
  tags        String[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  column      Column        @relation(fields: [columnId], references: [id], onDelete: Cascade)
  assignee    User?         @relation("TaskAssignee", fields: [assigneeId], references: [id])
  creator     User          @relation("TaskCreator", fields: [creatorId], references: [id])
  comments    Comment[]
  history     TaskHistory[]
  attachments Attachment[]

  @@index([status])
  @@index([priority])
  @@index([dueDate])
  @@index([title])
  @@map("tasks")
}

enum Priority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TaskStatus {
  OPEN
  IN_PROGRESS
  REVIEW
  DONE
  CANCELLED
}

model Comment {
  id         String            @id @default(cuid())
  content    String
  taskId     String
  authorType CommentAuthorType
  userId     String?
  clientId   String?
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  task   Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user   User?   @relation(fields: [userId], references: [id])
  client Client? @relation(fields: [clientId], references: [id])

  @@map("comments")
}

enum CommentAuthorType {
  USER
  CLIENT
}

model TaskHistory {
  id        String   @id @default(cuid())
  taskId    String
  action    String
  fromValue String?
  toValue   String?
  actorType String
  actorId   String
  actorName String
  createdAt DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@map("task_history")
}

model Attachment {
  id         String   @id @default(cuid())
  taskId     String
  filename   String
  mimeType   String
  size       Int
  storageKey String
  uploadedBy String
  createdAt  DateTime @default(now())

  task     Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploader User @relation(fields: [uploadedBy], references: [id])

  @@map("attachments")
}

model NotificationConfig {
  id               String   @id @default(cuid())
  organizationId   String   @unique
  whatsappEnabled  Boolean  @default(true)
  emailEnabled     Boolean  @default(true)
  taskCreated      Boolean  @default(false)
  taskMoved        Boolean  @default(true)
  taskCompleted    Boolean  @default(true)
  commentAdded     Boolean  @default(true)
  dueDateAlert     Boolean  @default(true)
  maximizebotToken String?
  saveOnTicket     Boolean  @default(true)
  startChatbot     Boolean  @default(false)
  smtpHost         String?
  smtpPort         Int?
  smtpUser         String?
  smtpPass         String?
  emailFrom        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("notification_configs")
}

model MessageTemplate {
  id             String            @id @default(cuid())
  organizationId String
  event          NotificationEvent
  channel        MessageChannel
  subject        String?
  body           String
  isActive       Boolean           @default(true)
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, event, channel])
  @@map("message_templates")
}

enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_DUE_DATE_APPROACHING
}

enum MessageChannel {
  WHATSAPP
  EMAIL
}

model NotificationLog {
  id             String             @id @default(cuid())
  organizationId String
  clientId       String?
  event          NotificationEvent
  channel        MessageChannel
  taskId         String?
  recipient      String
  message        String
  status         NotificationStatus @default(PENDING)
  error          String?
  sentAt         DateTime?
  createdAt      DateTime           @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("notification_logs")
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}
```

- [ ] **Step 2: Run migration on main database**

```bash
cd apps/api
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tramita \
  pnpm prisma migrate dev --name init
```

Expected: migration file created under `prisma/migrations/`, Prisma client generated.

- [ ] **Step 3: Create test database and apply migration**

```bash
createdb tramita_test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tramita_test \
  pnpm prisma migrate deploy
```

Expected: same schema applied to `tramita_test`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: complete Prisma schema + initial migration"
```

---

## Task 5: Core libs

**Files:**
- Create: `apps/api/src/lib/prisma.ts`
- Create: `apps/api/src/lib/redis.ts`
- Create: `apps/api/src/lib/jwt.ts`

- [ ] **Step 1: Create src/lib/prisma.ts**

```typescript
// apps/api/src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})
```

- [ ] **Step 2: Create src/lib/redis.ts**

```typescript
// apps/api/src/lib/redis.ts
import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})
```

- [ ] **Step 3: Create src/lib/jwt.ts**

```typescript
// apps/api/src/lib/jwt.ts
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
```

---

## Task 6: Fastify server + plugins

**Files:**
- Create: `apps/api/src/types/fastify.d.ts`
- Create: `apps/api/src/plugins/cors.ts`
- Create: `apps/api/src/plugins/rate-limit.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.ts`

- [ ] **Step 1: Create src/types/fastify.d.ts**

```typescript
// apps/api/src/types/fastify.d.ts
import type { JwtPayload } from '@/lib/jwt'

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload
  }
}
```

- [ ] **Step 2: Create src/plugins/cors.ts**

```typescript
// apps/api/src/plugins/cors.ts
import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

export default fp(async function (app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://tramita.autohubs.com.br']
      : true,
    credentials: true,
  })
})
```

Note: `fastify-plugin` ensures the plugin is not encapsulated (its decorations are visible to the parent scope).

- [ ] **Step 3: Install fastify-plugin**

```bash
cd apps/api && pnpm add fastify-plugin
```

- [ ] **Step 4: Create src/plugins/rate-limit.ts**

```typescript
// apps/api/src/plugins/rate-limit.ts
import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'

export default fp(async function (app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })
})
```

- [ ] **Step 5: Create src/server.ts**

```typescript
// apps/api/src/server.ts
import Fastify from 'fastify'
import corsPlugin from '@/plugins/cors'
import rateLimitPlugin from '@/plugins/rate-limit'
import { authRoutes } from '@/modules/auth/auth.routes'
import { AppError } from '@/errors/AppError'

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  app.register(corsPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(authRoutes, { prefix: '/auth' })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    if (error.statusCode) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    app.log.error(error)
    return reply.status(500).send({ message: 'Erro interno do servidor' })
  })

  return app
}
```

- [ ] **Step 6: Create src/app.ts**

```typescript
// apps/api/src/app.ts
import { buildApp } from '@/server'

const app = buildApp()

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
```

---

## Task 7: Middlewares

**Files:**
- Create: `apps/api/src/middlewares/verifyJWT.ts`
- Create: `apps/api/src/middlewares/requireRole.ts`
- Create: `apps/api/src/middlewares/verifyOrg.ts`
- Create: `apps/api/src/middlewares/checkSubscription.ts`
- Create: `apps/api/src/middlewares/checkPlanLimit.ts`

- [ ] **Step 1: Create verifyJWT.ts**

```typescript
// apps/api/src/middlewares/verifyJWT.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { AppError } from '@/errors/AppError'

export async function verifyJWT(request: FastifyRequest, _reply: FastifyReply) {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    throw new AppError(401, 'Token não fornecido')
  }
  try {
    request.user = verifyAccessToken(auth.slice(7))
  } catch {
    throw new AppError(401, 'Token inválido ou expirado')
  }
}
```

- [ ] **Step 2: Create requireRole.ts**

```typescript
// apps/api/src/middlewares/requireRole.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import type { Role } from '@/modules/auth/auth.types'

const ROLE_ORDER: Role[] = ['CLIENT', 'ORG_MEMBER', 'ORG_MANAGER', 'ORG_ADMIN', 'MASTER']

export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      throw new AppError(403, 'Acesso negado')
    }
  }
}

export function requireMinRole(minRole: Role) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    const userIdx = ROLE_ORDER.indexOf(request.user.role)
    const minIdx = ROLE_ORDER.indexOf(minRole)
    if (userIdx < minIdx) {
      throw new AppError(403, 'Acesso negado')
    }
  }
}
```

- [ ] **Step 3: Create verifyOrg.ts**

```typescript
// apps/api/src/middlewares/verifyOrg.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'

export async function verifyOrg(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER') return

  const params = request.params as Record<string, string>
  const requestedOrgId = params.organizationId ?? request.body as Record<string, string>

  if (requestedOrgId && requestedOrgId !== organizationId) {
    throw new AppError(403, 'Acesso negado')
  }
}
```

- [ ] **Step 4: Create checkSubscription.ts**

```typescript
// apps/api/src/middlewares/checkSubscription.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkSubscription(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId, role } = request.user
  if (role === 'MASTER' || !organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true },
  })

  if (org?.subscriptionStatus === 'SUSPENDED') {
    throw new AppError(403, 'Assinatura suspensa. Regularize o pagamento para continuar.')
  }
}
```

- [ ] **Step 5: Create checkPlanLimit.ts**

```typescript
// apps/api/src/middlewares/checkPlanLimit.ts
import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '@/errors/AppError'
import { prisma } from '@/lib/prisma'

export async function checkPlanLimit(request: FastifyRequest, _reply: FastifyReply) {
  const { organizationId } = request.user
  if (!organizationId) return

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { plan: true, _count: { select: { clients: { where: { isActive: true } } } } },
  })

  if (!org) throw new AppError(404, 'Organização não encontrada')

  if (org._count.clients >= org.plan.maxClients) {
    throw new AppError(422, `Limite de clientes atingido (máximo: ${org.plan.maxClients})`)
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/
git commit -m "feat: core libs, server factory, and tenant middlewares"
```

---

## Task 8: Test infrastructure

**Files:**
- Create: `apps/api/src/test/setup.ts`
- Create: `apps/api/src/test/helpers.ts`

- [ ] **Step 1: Create src/test/setup.ts**

```typescript
// apps/api/src/test/setup.ts
import { generateKeyPairSync } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { buildApp } from '@/server'

// Generate RS256 key pair for tests (runs once per worker before any test file)
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.JWT_PRIVATE_KEY = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
  .replace(/\n/g, '\\n')
process.env.JWT_PUBLIC_KEY = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()
  .replace(/\n/g, '\\n')
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/tramita_test'
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
process.env.NODE_ENV = 'test'

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
```

- [ ] **Step 2: Create src/test/helpers.ts**

```typescript
// apps/api/src/test/helpers.ts
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'

export async function createTestPlan(overrides?: Partial<{ name: string; maxClients: number }>) {
  return prisma.plan.create({
    data: {
      name: overrides?.name ?? 'Test Plan',
      maxClients: overrides?.maxClients ?? 50,
      priceMonthly: 197.0,
      features: { pdf: true, sse: true, attachments: true },
      isActive: true,
    },
  })
}

export async function createTestOrg(planId: string) {
  return prisma.organization.create({
    data: {
      name: 'Test Org',
      slug: `test-org-${Date.now()}`,
      email: `org-${Date.now()}@test.com`,
      planId,
      subscriptionStatus: 'ACTIVE',
    },
  })
}

export async function createTestUser(
  organizationId: string,
  overrides?: Partial<{ role: 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'; email: string; password: string }>,
) {
  const password = overrides?.password ?? 'Test@1234'
  return prisma.user.create({
    data: {
      name: 'Test User',
      email: overrides?.email ?? `user-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash(password, 10),
      role: overrides?.role ?? 'ORG_ADMIN',
      organizationId,
    },
  })
}

export async function createMasterUser() {
  // MASTER users have an organizationId pointing to a sentinel "master" org
  // For tests, we create a dedicated plan + org + MASTER-role user
  const plan = await createTestPlan({ name: 'Master Plan' })
  const org = await prisma.organization.create({
    data: {
      name: 'AutoHubs',
      slug: 'autohubs',
      email: 'master@autohubs.com',
      planId: plan.id,
      subscriptionStatus: 'ACTIVE',
    },
  })
  return prisma.user.create({
    data: {
      name: 'AutoHubs Master',
      email: `master-${Date.now()}@autohubs.com`,
      passwordHash: await bcrypt.hash('Master@1234', 10),
      role: 'MASTER',
      organizationId: org.id,
    },
  })
}

export async function createTestClient(organizationId: string) {
  const { prisma: _p, ...rest } = await import('@/lib/prisma')
  return prisma.client.create({
    data: {
      name: 'Test Client',
      email: `client-${Date.now()}@test.com`,
      passwordHash: await bcrypt.hash('Client@1234', 10),
      organizationId,
    },
  })
}

export async function loginAs(email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  })
  return JSON.parse(response.body) as {
    accessToken: string
    refreshToken: string
    user: { id: string; name: string; role: string; organizationId: string | null }
  }
}
```

---

## Task 9: Auth module — types + schema

**Files:**
- Create: `apps/api/src/modules/auth/auth.types.ts`
- Create: `apps/api/src/modules/auth/auth.schema.ts`

- [ ] **Step 1: Create auth.types.ts**

```typescript
// apps/api/src/modules/auth/auth.types.ts
export type Role = 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' | 'CLIENT'

export interface AuthUser {
  id: string
  name: string
  role: Role
  organizationId: string | null
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}
```

- [ ] **Step 2: Create auth.schema.ts**

```typescript
// apps/api/src/modules/auth/auth.schema.ts
import { z } from 'zod'

export const loginBodySchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token obrigatório'),
})

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token obrigatório'),
})

export type LoginBody = z.infer<typeof loginBodySchema>
export type RefreshBody = z.infer<typeof refreshBodySchema>
export type LogoutBody = z.infer<typeof logoutBodySchema>
```

---

## Task 10: Auth service TDD

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.test.ts` (write first)
- Create: `apps/api/src/modules/auth/auth.service.ts` (implement to pass tests)

- [ ] **Step 1: Write auth.service.test.ts**

```typescript
// apps/api/src/modules/auth/auth.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { generateAccessToken, verifyAccessToken } from '@/lib/jwt'
import {
  hashPassword,
  verifyPassword,
  login,
  refreshSession,
  logout,
} from '@/modules/auth/auth.service'
import { createTestPlan, createTestOrg, createTestUser, createTestClient } from '@/test/helpers'
import { AppError } from '@/errors/AppError'

describe('hashPassword', () => {
  it('produces a different string', async () => {
    const hash = await hashPassword('secret123')
    expect(hash).not.toBe('secret123')
    expect(hash.length).toBeGreaterThan(20)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    expect(await verifyPassword('correct', hash)).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('generateAccessToken / verifyAccessToken', () => {
  it('encodes and decodes payload correctly', () => {
    const payload = { sub: 'user-1', role: 'ORG_ADMIN' as const, organizationId: 'org-1' }
    const token = generateAccessToken(payload)
    const decoded = verifyAccessToken(token)
    expect(decoded.sub).toBe('user-1')
    expect(decoded.role).toBe('ORG_ADMIN')
    expect(decoded.organizationId).toBe('org-1')
  })
})

describe('login', () => {
  let planId: string
  let orgId: string

  beforeEach(async () => {
    const plan = await createTestPlan()
    planId = plan.id
    const org = await createTestOrg(planId)
    orgId = org.id
  })

  it('returns tokens and user for valid ORG_ADMIN credentials', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123', role: 'ORG_ADMIN' })

    const result = await login(email, 'Pass@123')

    expect(result.user.role).toBe('ORG_ADMIN')
    expect(result.user.organizationId).toBe(orgId)
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
  })

  it('stores refresh token in Redis', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123' })
    const result = await login(email, 'Pass@123')

    const stored = await redis.get(`refresh:${result.refreshToken}`)
    expect(stored).toBeTruthy()
  })

  it('returns CLIENT role for client credentials', async () => {
    const clientEmail = `client-${Date.now()}@test.com`
    await prisma.client.create({
      data: {
        name: 'Test Client',
        email: clientEmail,
        passwordHash: await bcrypt.hash('Client@123', 10),
        organizationId: orgId,
      },
    })

    const result = await login(clientEmail, 'Client@123')

    expect(result.user.role).toBe('CLIENT')
    expect(result.user.organizationId).toBe(orgId)
  })

  it('throws 401 for wrong password', async () => {
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(orgId, { email, password: 'Pass@123' })

    await expect(login(email, 'wrong')).rejects.toThrow(AppError)
    await expect(login(email, 'wrong')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 for nonexistent email', async () => {
    await expect(login('nobody@test.com', 'any')).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('refreshSession', () => {
  it('returns new access token for valid refresh token', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    const result = await refreshSession(refreshToken)

    expect(result.accessToken).toBeTruthy()
    const decoded = verifyAccessToken(result.accessToken)
    expect(decoded.role).toBe('ORG_ADMIN')
  })

  it('throws 401 for invalid token', async () => {
    await expect(refreshSession('invalid-token')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 after logout (token removed from Redis)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    await logout(refreshToken)

    await expect(refreshSession(refreshToken)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('logout', () => {
  it('removes refresh token from Redis', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const email = `admin-${Date.now()}@test.com`
    await createTestUser(org.id, { email, password: 'Pass@123' })

    const { refreshToken } = await login(email, 'Pass@123')
    await logout(refreshToken)

    const stored = await redis.get(`refresh:${refreshToken}`)
    expect(stored).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (no service yet)**

```bash
cd apps/api && pnpm test src/modules/auth/auth.service.test.ts
```

Expected: FAIL — "Cannot find module '@/modules/auth/auth.service'"

- [ ] **Step 3: Create auth.service.ts to make tests pass**

```typescript
// apps/api/src/modules/auth/auth.service.ts
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { generateAccessToken } from '@/lib/jwt'
import { AppError } from '@/errors/AppError'
import type { LoginResponse } from '@/modules/auth/auth.types'

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
  if (user && await verifyPassword(password, user.passwordHash)) {
    return buildSession(user.id, user.name, user.role as 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER', user.organizationId)
  }

  // Fall back to Client table
  const client = await prisma.client.findFirst({ where: { email } })
  if (client && await verifyPassword(password, client.passwordHash)) {
    return buildSession(client.id, client.name, 'CLIENT', client.organizationId)
  }

  throw new AppError(401, 'Credenciais inválidas')
}

async function buildSession(
  id: string,
  name: string,
  role: 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' | 'CLIENT',
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

  const payload = JSON.parse(stored) as { sub: string; role: 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER' | 'CLIENT'; organizationId: string }
  const accessToken = generateAccessToken(payload)
  return { accessToken }
}

export async function logout(refreshToken: string): Promise<void> {
  await redis.del(`refresh:${refreshToken}`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test src/modules/auth/auth.service.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.service.test.ts \
        apps/api/src/modules/auth/auth.types.ts apps/api/src/modules/auth/auth.schema.ts
git commit -m "feat: auth service with JWT RS256 + Redis refresh tokens (TDD)"
```

---

## Task 11: Auth routes TDD

**Files:**
- Create: `apps/api/src/modules/auth/auth.routes.test.ts` (write first)
- Create: `apps/api/src/modules/auth/auth.routes.ts` (implement to pass tests)

- [ ] **Step 1: Write auth.routes.test.ts**

```typescript
// apps/api/src/modules/auth/auth.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { verifyAccessToken } from '@/lib/jwt'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg } from '@/test/helpers'

let orgId: string
let planId: string

beforeEach(async () => {
  const plan = await createTestPlan()
  planId = plan.id
  const org = await createTestOrg(planId)
  orgId = org.id
})

describe('POST /auth/login', () => {
  it('returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-email', password: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 for wrong password', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('correct', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for nonexistent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@test.com', password: 'any' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns tokens + user for valid ORG_ADMIN credentials', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user.role).toBe('ORG_ADMIN')
  })

  it('JWT payload contains correct role and organizationId', async () => {
    await prisma.user.create({
      data: {
        name: 'Manager',
        email: 'manager@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_MANAGER',
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'manager@test.com', password: 'Pass@123' },
    })
    const { accessToken } = JSON.parse(res.body)
    const decoded = verifyAccessToken(accessToken)
    expect(decoded.role).toBe('ORG_MANAGER')
    expect(decoded.organizationId).toBe(orgId)
  })

  it('returns CLIENT role for client login', async () => {
    await prisma.client.create({
      data: {
        name: 'Cliente',
        email: 'cliente@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        organizationId: orgId,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cliente@test.com', password: 'Pass@123' },
    })
    expect(res.statusCode).toBe(200)
    const { user } = JSON.parse(res.body)
    expect(user.role).toBe('CLIENT')
  })
})

describe('POST /auth/refresh', () => {
  it('returns new access token for valid refresh token', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    const { refreshToken } = JSON.parse(loginRes.body)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.accessToken).toBeTruthy()
  })

  it('returns 401 for invalid refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'invalid-token-uuid' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('invalidates refresh token', async () => {
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('Pass@123', 10),
        role: 'ORG_ADMIN',
        organizationId: orgId,
      },
    })
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.com', password: 'Pass@123' },
    })
    const { refreshToken } = JSON.parse(loginRes.body)

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken },
    })
    expect(logoutRes.statusCode).toBe(204)

    // Token should no longer work
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    })
    expect(refreshRes.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test src/modules/auth/auth.routes.test.ts
```

Expected: FAIL — auth routes not registered yet.

- [ ] **Step 3: Create auth.routes.ts to make tests pass**

```typescript
// apps/api/src/modules/auth/auth.routes.ts
import type { FastifyInstance } from 'fastify'
import { AppError } from '@/errors/AppError'
import { login, refreshSession, logout } from '@/modules/auth/auth.service'
import {
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
} from '@/modules/auth/auth.schema'

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const result = loginBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    const data = await login(result.data.email, result.data.password)
    return reply.status(200).send(data)
  })

  app.post('/refresh', async (request, reply) => {
    const result = refreshBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    const data = await refreshSession(result.data.refreshToken)
    return reply.status(200).send(data)
  })

  app.post('/logout', async (request, reply) => {
    const result = logoutBodySchema.safeParse(request.body)
    if (!result.success) {
      throw new AppError(400, result.error.errors[0].message)
    }
    await logout(result.data.refreshToken)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 4: Run all tests to verify everything passes**

```bash
cd apps/api && pnpm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat: auth routes POST /login /refresh /logout (TDD)"
```

---

## Task 12: Seed script

**Files:**
- Create: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Add seed script to apps/api/package.json**

In `apps/api/package.json`, add to the root-level:
```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 2: Create prisma/seed.ts**

```typescript
// apps/api/prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Plans
  const starter = await prisma.plan.upsert({
    where: { id: 'plan-starter' },
    update: {},
    create: {
      id: 'plan-starter',
      name: 'Starter',
      maxClients: 15,
      priceMonthly: 97.0,
      features: { pdf: false, sse: false, attachments: false },
    },
  })

  const pro = await prisma.plan.upsert({
    where: { id: 'plan-pro' },
    update: {},
    create: {
      id: 'plan-pro',
      name: 'Pro',
      maxClients: 50,
      priceMonthly: 197.0,
      features: { pdf: true, sse: true, attachments: true },
    },
  })

  await prisma.plan.upsert({
    where: { id: 'plan-enterprise' },
    update: {},
    create: {
      id: 'plan-enterprise',
      name: 'Enterprise',
      maxClients: 999,
      priceMonthly: 497.0,
      features: { pdf: true, sse: true, attachments: true, whiteLabel: true },
    },
  })

  // Master org (AutoHubs itself)
  const masterOrg = await prisma.organization.upsert({
    where: { slug: 'autohubs' },
    update: {},
    create: {
      name: 'AutoHubs',
      slug: 'autohubs',
      email: 'contato@autohubs.com.br',
      planId: pro.id,
      subscriptionStatus: 'ACTIVE',
    },
  })

  // MASTER user
  await prisma.user.upsert({
    where: { email: 'master@autohubs.com.br' },
    update: {},
    create: {
      name: 'AutoHubs Master',
      email: 'master@autohubs.com.br',
      passwordHash: await bcrypt.hash(process.env.MASTER_PASSWORD ?? 'Master@AutoHubs2025', 10),
      role: 'MASTER',
      organizationId: masterOrg.id,
    },
  })

  // G2A org (first client org)
  const g2aOrg = await prisma.organization.upsert({
    where: { slug: 'g2a' },
    update: {},
    create: {
      name: 'G2A Contabilidade',
      slug: 'g2a',
      email: 'contato@g2a.com.br',
      planId: pro.id,
      subscriptionStatus: 'ACTIVE',
    },
  })

  await prisma.user.upsert({
    where: { email: 'admin@g2a.com.br' },
    update: {},
    create: {
      name: 'Admin G2A',
      email: 'admin@g2a.com.br',
      passwordHash: await bcrypt.hash('G2A@Admin2025', 10),
      role: 'ORG_ADMIN',
      organizationId: g2aOrg.id,
    },
  })

  console.log('Seed concluído: planos Starter/Pro/Enterprise, usuário MASTER, org G2A')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Run seed**

```bash
cd apps/api && pnpm prisma db seed
```

Expected: "Seed concluído: planos Starter/Pro/Enterprise, usuário MASTER, org G2A"

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/package.json
git commit -m "feat: seed — Starter/Pro/Enterprise plans + MASTER user + G2A org"
```

---

## Task 13: Web app skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.5",
    "@types/react-dom": "^19.1.5",
    "@vitejs/plugin-react": "^4.5.2",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vitest": "^3.2.3"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "outDir": "dist",
    "baseUrl": "."
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/web/vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
```

- [ ] **Step 4: Create apps/web/index.html**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tramita — AutoHubs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create apps/web/src/main.tsx**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: Create apps/web/src/App.tsx**

```typescript
export default function App() {
  return <div>Tramita — em construção</div>
}
```

- [ ] **Step 7: Install web dependencies**

```bash
cd apps/web && pnpm install
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/
git commit -m "chore: web app skeleton (React 19 + Vite)"
```

---

## Task 14: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/api && pnpm test
```

Expected: All tests pass, no skipped tests.

- [ ] **Step 2: Run test coverage**

```bash
cd apps/api && pnpm test:coverage
```

Expected: Coverage ≥ 80% on `src/modules/**` and `src/lib/**`.

- [ ] **Step 3: Verify health endpoint works**

```bash
cd apps/api && pnpm dev &
sleep 2
curl http://localhost:3000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Verify login works with seeded MASTER user**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"master@autohubs.com.br","password":"Master@AutoHubs2025"}'
```

Expected: JSON with `accessToken`, `refreshToken`, `user.role = "MASTER"`.

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat: Fase 1 completa — auth JWT RS256, middlewares, seed, testes passando"
```

---

## Self-Review Against Spec

### Fase 1 checklist coverage:

| Item | Task |
|------|------|
| Configurar Vitest no monorepo | Task 2 |
| Configurar banco de teste (DATABASE_URL_TEST + migrate) | Task 4 + Task 8 |
| Helper buildApp() | Task 6 |
| auth.service.test.ts — hash, JWT | Task 10 |
| auth.routes.test.ts — POST /auth/login | Task 11 |
| auth.routes.test.ts — POST /auth/refresh e /auth/logout | Task 11 |
| Inicializar monorepo pnpm: apps/api + apps/web | Task 1 + Task 13 |
| Setup Fastify v5 + TypeScript strict + Zod | Task 2 + Task 6 |
| Configurar Prisma v6 + PostgreSQL (schema completo) | Task 4 |
| Configurar Redis + BullMQ | Task 5 (Redis done; BullMQ client deferred to Phase 5 worker) |
| Módulo auth: login, JWT RS256, refresh, logout | Task 9-11 |
| Middleware verifyOrg | Task 7 |
| Middleware checkSubscription | Task 7 |
| Middleware checkPlanLimit | Task 7 |
| Rate limiting + CORS | Task 6 |
| GET /health | Task 6 |
| Seed: Starter/Pro/Enterprise + MASTER | Task 12 |
