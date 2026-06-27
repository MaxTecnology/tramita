# Badge de Pendentes (tempo real) + Filtros na Lista de Requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O escritório vê, em tempo real e sem precisar abrir a tela, quantas solicitações de clientes estão pendentes (badge no menu), e a tela "Solicitações dos Clientes" ganha filtros de busca e período para não embolar com 200+ clientes.

**Architecture:** Reusa a infraestrutura de SSE já existente (Redis pub/sub + `EventSource`), generalizando-a com um helper compartilhado de subscriber, um canal por organização (`org:<id>:requests`) e um endpoint de contagem leve dedicado. No frontend, replica o padrão já usado em `useBoardStream` para o novo stream, e replica o padrão de filtro client-side já usado em `Processes.tsx`/`Clients.tsx` para os novos filtros.

**Tech Stack:** Fastify v5 + ioredis (pub/sub) + Vitest (API); React 19 + TanStack Query + EventSource nativo (Web).

## Global Constraints

- TypeScript `strict: true` — sem `any`.
- Rotas com parâmetro dinâmico (`/:id`) devem vir DEPOIS de rotas estáticas no mesmo prefixo (`/pending-count`, `/stream`), senão o Fastify casa a rota dinâmica primeiro.
- Rodar `pnpm --filter api test` e `pnpm --filter web test` antes de cada commit; baseline atual: 167/167 testes na API, 1 arquivo pré-existente falhando no web (`TemplateEditor.test.tsx`, 2/10) não relacionado a este trabalho — não piorar esse número.
- Containers Postgres (dev :5432, test :5433) e Redis (:6379) já devem estar rodando localmente (`docker compose up -d postgres postgres_test redis`).

---

## Task 1: SSE — helper compartilhado de subscriber + canal por organização

**Files:**
- Modify: `apps/api/src/lib/sse.ts`
- Modify: `apps/api/src/modules/stream/stream.routes.ts`
- Test: `apps/api/src/modules/stream/stream.test.ts` (deve continuar passando sem alteração nos casos existentes)

**Interfaces:**
- Produces: `publishOrgEvent(organizationId: string, payload: SSEEvent): Promise<void>` — publica em `org:${organizationId}:requests`. `attachSSESubscriber(request: FastifyRequest, reply: FastifyReply, channel: string): void` — encapsula hijack + headers + subscribe + heartbeat + cleanup, reutilizável por qualquer rota SSE do projeto.
- Consumes: `redis` de `@/lib/redis` (já existe).

- [ ] **Step 1: Escrever o teste que confirma o comportamento atual antes de tocar no código**

Antes de qualquer alteração, rodar a suíte de stream existente para confirmar a baseline:

```bash
pnpm --filter api test -- stream.test.ts
```

Expected: PASS (3 testes — emissão de evento, 401 sem token, 401 com token inválido, 404 para board inexistente — confirme a contagem exata rodando antes de prosseguir).

- [ ] **Step 2: Adicionar `publishOrgEvent` e o tipo de evento novo em `sse.ts`**

Substituir o conteúdo de `apps/api/src/lib/sse.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify'
import { redis } from '@/lib/redis'

export interface SSEEvent {
  event: 'task:moved' | 'task:created' | 'task:updated' | 'comment:added' | 'request:changed'
  data: Record<string, unknown>
}

export async function publishBoardEvent(boardId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`board:${boardId}`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}

export async function publishOrgEvent(organizationId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`org:${organizationId}:requests`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}

// Hijacks the reply, subscribes to `channel` on a dedicated Redis connection, and
// forwards every published message as an SSE event. Shared by every SSE route in
// the project so the hijack/heartbeat/cleanup plumbing exists in exactly one place.
export function attachSSESubscriber(
  request: FastifyRequest,
  reply: FastifyReply,
  channel: string,
): void {
  reply.hijack()
  const raw = reply.raw

  // Forward CORS headers already set by @fastify/cors plugin (via onRequest hook),
  // then overlay SSE-specific headers. This ensures Vary: Origin and correct
  // Access-Control-Allow-Origin are sent even with hijacked responses.
  raw.writeHead(200, {
    ...reply.getHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  // Flush headers immediately — writeHead buffers until first write()
  raw.write(': connected\n\n')

  // Dedicated Redis subscriber per connection
  const sub = redis.duplicate()

  sub.on('message', (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: unknown }
      raw.write(`event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`)
    } catch { /* ignore malformed messages */ }
  })

  sub.subscribe(channel).catch(() => {})

  // Heartbeat every 15 seconds — keeps connection alive and resets browser SSE timeout
  const heartbeat = setInterval(() => {
    raw.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
  }, 15_000)

  // Cleanup on client disconnect
  request.raw.on('close', () => {
    clearInterval(heartbeat)
    sub.unsubscribe().catch(() => {})
    sub.quit().catch(() => {})
  })
}
```

- [ ] **Step 3: Refatorar `stream.routes.ts` para usar o helper compartilhado**

Substituir o conteúdo de `apps/api/src/modules/stream/stream.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyAccessToken } from '@/lib/jwt'
import { prisma } from '@/lib/prisma'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'

export async function streamRoutes(app: FastifyInstance) {
  app.get('/boards/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { token } = request.query as { token?: string }

    // Auth via query param — EventSource API doesn't support custom headers
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

    // Verify board exists and belongs to the user's org
    const board = await prisma.board.findFirst({
      where: { id, organizationId: user.organizationId!, isActive: true },
    })
    if (!board) throw new AppError(404, 'Board não encontrado')

    attachSSESubscriber(request, reply, `board:${id}`)
  })
}
```

- [ ] **Step 4: Rodar o teste de stream e confirmar que ainda passa, idêntico à baseline**

```bash
pnpm --filter api test -- stream.test.ts
```

Expected: PASS, mesma contagem de testes do Step 1 — o comportamento é idêntico, só a implementação interna mudou.

- [ ] **Step 5: Rodar a suíte completa da API**

```bash
pnpm --filter api test
```

Expected: PASS, 167/167 (nenhuma rota nova foi adicionada ainda nesta task, só refatoração).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/sse.ts apps/api/src/modules/stream/stream.routes.ts
git commit -m "refactor(api): extrair subscriber SSE compartilhado e adicionar publishOrgEvent"
```

---

## Task 2: Disparar `request:changed` nas mutações de Request

**Files:**
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.service.test.ts`

**Interfaces:**
- Consumes: `publishOrgEvent(organizationId, payload)` de `@/lib/sse` (Task 1).
- Produces: nenhuma interface nova — só efeito colateral adicional em `createRequest`, `approveRequest`, `rejectRequest`, `cancelRequest`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `apps/api/src/modules/requests/requests.service.test.ts` (confirme que `vi`, `vi.spyOn` e `redis` já estão disponíveis/importados no topo do arquivo — se `redis` não estiver importado, adicionar `import { redis } from '@/lib/redis'` ao bloco de imports existente):

```typescript
describe('publishOrgEvent ao mudar status da request', () => {
  it('createRequest publica request:changed no canal da org', async () => {
    const publishSpy = vi.spyOn(redis, 'publish').mockResolvedValue(0 as unknown as number)
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    await createRequest(org.id, client.id, { title: 'Pedido com evento' })

    expect(publishSpy).toHaveBeenCalledWith(
      `org:${org.id}:requests`,
      expect.stringContaining('"request:changed"'),
    )
    publishSpy.mockRestore()
  })

  it('approveRequest e rejectRequest publicam request:changed', async () => {
    const publishSpy = vi.spyOn(redis, 'publish').mockResolvedValue(0 as unknown as number)
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)

    const r1 = await createRequest(org.id, client.id, { title: 'Pedido 1' })
    await approveRequest(r1.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    const r2 = await createRequest(org.id, client.id, { title: 'Pedido 2' })
    await rejectRequest(r2.id, org.id, admin.id, { reason: 'Teste' })

    const orgChannelCalls = publishSpy.mock.calls.filter(([channel]) => channel === `org:${org.id}:requests`)
    expect(orgChannelCalls.length).toBeGreaterThanOrEqual(4) // create x2, approve, reject
    publishSpy.mockRestore()
  })

  it('cancelRequest publica request:changed', async () => {
    const publishSpy = vi.spyOn(redis, 'publish').mockResolvedValue(0 as unknown as number)
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido a cancelar' })
    publishSpy.mockClear() // ignora o publish do createRequest, foca no do cancelRequest

    await cancelRequest(request.id, org.id, client.id)

    expect(publishSpy).toHaveBeenCalledWith(
      `org:${org.id}:requests`,
      expect.stringContaining('"request:changed"'),
    )
    publishSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: FAIL — `publishSpy` nunca é chamado com o canal `org:...:requests`, pois `publishOrgEvent` ainda não é chamado em nenhuma função.

- [ ] **Step 3: Importar `publishOrgEvent` e chamá-lo nas 4 funções**

No topo de `apps/api/src/modules/requests/requests.service.ts`, adicionar ao bloco de imports:

```typescript
import { publishOrgEvent } from '@/lib/sse'
```

Em `createRequest`, logo após o bloco `await Promise.all(admins.map(...))` e antes do `return request`, adicionar:

```typescript
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

```

Em `cancelRequest`, a função inteira passa a ser:

```typescript
export async function cancelRequest(id: string, organizationId: string, clientId: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Apenas solicitações pendentes podem ser canceladas')
  }
  const updated = await prisma.request.update({ where: { id }, data: { status: 'CANCELLED' } })
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}
```

Em `approveRequest`, logo após o bloco `await enqueueNotification({ event: 'REQUEST_APPROVED', ... })` e antes do `return updatedRequest`, adicionar:

```typescript
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

```

Em `rejectRequest`, logo após o bloco `await enqueueNotification({ event: 'REQUEST_REJECTED', ... })` e antes do `return updated`, adicionar:

```typescript
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: PASS em todos os casos, incluindo os novos.

- [ ] **Step 5: Rodar a suíte completa**

```bash
pnpm --filter api test
```

Expected: PASS, 167 + 3 novos = 170/170.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/requests.service.ts apps/api/src/modules/requests/requests.service.test.ts
git commit -m "feat(api): publicar request:changed no canal SSE da org a cada mutação de request"
```

---

## Task 3: Endpoints `GET /requests/pending-count` e `GET /requests/stream`

**Files:**
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.routes.ts`
- Test: `apps/api/src/modules/requests/requests.service.test.ts`
- Test: `apps/api/src/modules/requests/requests.routes.test.ts`

**Interfaces:**
- Consumes: `attachSSESubscriber(request, reply, channel)` de `@/lib/sse` (Task 1). `verifyAccessToken` de `@/lib/jwt` (já existe, usado em `stream.routes.ts`).
- Produces: `countPendingRequests(organizationId: string): Promise<number>` em `requests.service.ts`. Rotas `GET /requests/pending-count` → `{ count: number }`, `GET /requests/stream?token=` (SSE).

- [ ] **Step 1: Escrever o teste de serviço que falha**

Adicionar ao final de `apps/api/src/modules/requests/requests.service.test.ts`:

```typescript
describe('countPendingRequests', () => {
  it('conta apenas requests PENDING da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)

    await createRequest(org.id, client.id, { title: 'Pendente 1' })
    const r2 = await createRequest(org.id, client.id, { title: 'Pendente 2' })
    const r3 = await createRequest(org.id, client.id, { title: 'Vai ser rejeitada' })
    await rejectRequest(r3.id, org.id, admin.id, {})

    expect(await countPendingRequests(org.id)).toBe(2)

    await cancelRequest(r2.id, org.id, client.id)
    expect(await countPendingRequests(org.id)).toBe(1)
  })

  it('não conta requests de outra organização', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-count' })
    const clientA = await createTestClient(orgA.id)
    await createTestClient(orgB.id)

    await createRequest(orgA.id, clientA.id, { title: 'Da A' })

    expect(await countPendingRequests(orgB.id)).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: FAIL — `countPendingRequests` não existe.

- [ ] **Step 3: Implementar `countPendingRequests` em `requests.service.ts`**

Adicionar ao final do arquivo:

```typescript
export async function countPendingRequests(organizationId: string): Promise<number> {
  return prisma.request.count({ where: { organizationId, status: 'PENDING' } })
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Escrever os testes de rota que falham**

Adicionar ao final de `apps/api/src/modules/requests/requests.routes.test.ts`:

```typescript
describe('GET /requests/pending-count', () => {
  it('retorna a contagem de pendentes da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido 1' },
    })
    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido 2' },
    })

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ count: 2 })
  })

  it('CLIENT não acessa este endpoint (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const res = await app.inject({ method: 'GET', url: '/requests/pending-count', headers: { authorization: auth } })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /requests/stream', () => {
  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/requests/stream' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 401 com token inválido', async () => {
    const res = await app.inject({ method: 'GET', url: '/requests/stream?token=invalid-token' })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 403 para CLIENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const authHeader = await getAuthHeader(client.email, 'Client@1234')
    const token = authHeader.replace('Bearer ', '')

    const res = await app.inject({ method: 'GET', url: `/requests/stream?token=${token}` })
    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 6: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.routes.test.ts
```

Expected: FAIL — rotas `/requests/pending-count` e `/requests/stream` não existem (404).

- [ ] **Step 7: Implementar as rotas em `requests.routes.ts`**

Substituir o conteúdo de `apps/api/src/modules/requests/requests.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { verifyAccessToken } from '@/lib/jwt'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import { approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema } from './requests.schema'
import {
  listRequestsForOrg,
  getRequestById,
  approveRequest,
  rejectRequest,
  countPendingRequests,
} from './requests.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function requestsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const result = listRequestsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
  })

  // Rotas estáticas ANTES de /:id, senão o Fastify casa /:id primeiro
  app.get('/pending-count', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const count = await countPendingRequests(request.user.organizationId!)
    return reply.send({ count })
  })

  app.get('/stream', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

    if (!ORG_ROLES.includes(user.role as typeof ORG_ROLES[number])) {
      throw new AppError(403, 'Acesso negado')
    }

    attachSSESubscriber(request, reply, `org:${user.organizationId}:requests`)
  })

  app.get('/:id', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getRequestById(id, request.user.organizationId!))
  })

  app.post('/:id/approve', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = approveRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
    )
  })

  app.post('/:id/reject', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = rejectRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
  })
}
```

Note: `app.get('/stream', ...)` não usa `requireRole` (que lê `request.user`, populado pelo hook `verifyJWT` via header `Authorization`) porque o `EventSource` do browser não manda headers customizados — a auth é via query param `token`, igual ao padrão já usado em `/boards/:id/stream`. Por isso o `app.addHook('preHandler', verifyJWT)` no topo do arquivo não afeta essa rota especificamente em termos de auth real (ele roda e provavelmente lança 401 antes mesmo de chegar no handler, já que não há header `Authorization` — **isso é um problema**: ver Step 7b abaixo.

- [ ] **Step 7b: Excluir `/stream` do hook global de `verifyJWT`**

Como o hook `app.addHook('preHandler', verifyJWT)` roda para TODAS as rotas do plugin antes de qualquer handler — incluindo `/stream`, que não tem header `Authorization` — a request vai falhar com 401 disparado pelo hook antes de chegar no handler que faz a autenticação manual via query param. É exatamente o motivo de `/boards/:id/stream` viver em um plugin (`streamRoutes`) que **não** registra `verifyJWT` como hook global. Para resolver sem duplicar o módulo inteiro: registrar a rota `/stream` num encapsulamento separado dentro do mesmo arquivo, usando `app.register` com uma função async que NÃO herda o hook do escopo pai. Ajustar `requestsRoutes` assim — mover `app.addHook('preHandler', verifyJWT)` para dentro de um sub-plugin que envolve todas as rotas EXCETO `/stream`:

```typescript
export async function requestsRoutes(app: FastifyInstance) {
  // /stream fica fora do hook global de verifyJWT — autentica via query param,
  // igual ao padrão de /boards/:id/stream (EventSource não manda headers customizados)
  app.get('/stream', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

    if (!ORG_ROLES.includes(user.role as typeof ORG_ROLES[number])) {
      throw new AppError(403, 'Acesso negado')
    }

    attachSSESubscriber(request, reply, `org:${user.organizationId}:requests`)
  })

  app.register(async (authed) => {
    authed.addHook('preHandler', verifyJWT)

    authed.get('/', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const result = listRequestsQuerySchema.safeParse(request.query)
      const query = result.success ? result.data : {}
      return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
    })

    authed.get('/pending-count', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const count = await countPendingRequests(request.user.organizationId!)
      return reply.send({ count })
    })

    authed.get('/:id', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      return reply.send(await getRequestById(id, request.user.organizationId!))
    })

    authed.post('/:id/approve', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = approveRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
      )
    })

    authed.post('/:id/reject', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = rejectRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
    })
  })
}
```

Isso é o conteúdo FINAL do arquivo — descarte a versão do Step 7 e use esta.

- [ ] **Step 8: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- requests.routes.test.ts
```

Expected: PASS em todos os casos, incluindo os 5 novos (`pending-count` x2, `stream` x3).

- [ ] **Step 9: Rodar a suíte completa**

```bash
pnpm --filter api test
```

Expected: PASS, 170 + 5 novos = 175/175.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/requests/requests.service.ts apps/api/src/modules/requests/requests.routes.ts apps/api/src/modules/requests/requests.service.test.ts apps/api/src/modules/requests/requests.routes.test.ts
git commit -m "feat(api): endpoints GET /requests/pending-count e GET /requests/stream"
```

---

## Task 4: Frontend — hook `useRequestsBadgeStream`

**Files:**
- Create: `apps/web/src/hooks/useRequestsBadgeStream.ts`

**Interfaces:**
- Consumes: nenhuma dependência de outras tasks deste plano além do endpoint `/requests/stream` (Task 3, já no backend).
- Produces: `useRequestsBadgeStream(): void` — hook sem retorno, side-effect only, que invalida `['requests-pending-count']` a cada evento `request:changed`.

- [ ] **Step 1: Criar o hook**

```typescript
// apps/web/src/hooks/useRequestsBadgeStream.ts
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export function useRequestsBadgeStream(): void {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return

      const token = localStorage.getItem('accessToken')
      if (!token) return

      // 50ms delay prevents React StrictMode double-invocation from opening two
      // simultaneous connections — cleanup cancels the timer before EventSource opens
      connectTimerRef.current = setTimeout(() => {
        if (cancelled) return

        const es = new EventSource(`${BASE_URL}/requests/stream?token=${token}`)
        esRef.current = es

        es.addEventListener('request:changed', () => {
          queryClient.invalidateQueries({ queryKey: ['requests-pending-count'] })
        })

        es.addEventListener('heartbeat', () => {
          retryDelay.current = 1000
        })

        es.onerror = () => {
          es.close()
          esRef.current = null
          if (cancelled) return
          const delay = retryDelay.current
          retryDelay.current = Math.min(delay * 2, 30_000)
          setTimeout(connect, delay)
        }
      }, 50)
    }

    connect()

    return () => {
      cancelled = true
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [queryClient])
}
```

Esse hook segue exatamente o mesmo padrão de `apps/web/src/hooks/useBoardStream.ts` (reconexão com backoff exponencial, delay anti-StrictMode), mas sem depender de um `boardId` — a conexão é única por sessão de usuário logado no painel, escopada pelo `organizationId` do próprio token no backend.

- [ ] **Step 2: Verificar compilação**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useRequestsBadgeStream.ts
git commit -m "feat(web): hook de stream SSE para contagem de solicitações pendentes"
```

---

## Task 5: Frontend — badge no menu do escritório

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `useRequestsBadgeStream()` (Task 4). Endpoint `GET /requests/pending-count` (Task 3).
- Produces: `SidebarLink` ganha prop opcional `badge?: number`.

- [ ] **Step 1: Adicionar a query de contagem e o hook de stream, e o prop `badge` no `SidebarLink`**

Em `apps/web/src/components/AppLayout.tsx`, ajustar os imports do topo (linhas 1-6):

```typescript
import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useRequestsBadgeStream } from '@/hooks/useRequestsBadgeStream'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, Inbox, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
```

Dentro de `export default function AppLayout()`, logo após `const role = user?.role ?? ''` (antes do `return`), adicionar:

```typescript
  const isOrgRole = ORG_ROLES.includes(role)

  const { data: pendingCount } = useQuery<{ count: number }>({
    queryKey: ['requests-pending-count'],
    queryFn: () => api.get('/requests/pending-count').then((r) => r.data),
    enabled: isOrgRole,
    refetchOnWindowFocus: true,
  })

  useRequestsBadgeStream()
```

Note: chamar `useRequestsBadgeStream()` incondicionalmente (hooks não podem ser condicionais) está correto aqui — o hook internamente já não abre conexão se não houver `accessToken` no `localStorage`, e qualquer usuário autenticado tem token, então a única "perda" é abrir uma conexão SSE para roles que não usam o badge (CLIENT nunca renderiza `AppLayout`, só `PortalLayout` — então na prática só ORG_* e o próprio hook não causa efeito colateral indesejado: a rota `/requests/stream` no backend já valida o role e retornaria 403 para roles fora de `ORG_ADMIN/ORG_MANAGER/ORG_MEMBER`, mas como `AppLayout` só é renderizado dentro de `ProtectedRoute allowedRoles={ORG_ROLES}` no router, isso nunca acontece na prática).

Trocar a linha do `SidebarLink` de Solicitações (dentro de `<nav>`):

```typescript
          {ORG_ROLES.includes(role) && (
            <SidebarLink
              to="/app/requests"
              icon={<Inbox size={16} />}
              label="Solicitações"
              badge={pendingCount?.count}
              onClick={handleNavClick}
            />
          )}
```

- [ ] **Step 2: Atualizar o componente `SidebarLink` para renderizar o badge**

Substituir a função `SidebarLink` no final do arquivo:

```typescript
function SidebarLink({
  to,
  icon,
  label,
  badge,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-medium flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  )
}
```

- [ ] **Step 3: Verificar compilação e rodar os testes do frontend**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
```

Expected: `tsc` sem erros novos. Vitest: mesma baseline de antes (`TemplateEditor.test.tsx` 2/10 falhando, pré-existente — sem novas falhas; `AppLayout.tsx` não tem teste próprio hoje, então não deve haver mudança na contagem de testes desta task).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): badge de solicitações pendentes no menu do escritório, atualizado via SSE"
```

---

## Task 6: Frontend — filtros de busca e período na lista do escritório

**Files:**
- Modify: `apps/web/src/pages/app/Requests.tsx`

**Interfaces:**
- Consumes: nenhuma interface nova de outras tasks — opera sobre os dados já retornados por `GET /requests?status=` (existente).

- [ ] **Step 1: Adicionar os estados de filtro e a lógica de filtragem client-side**

Em `apps/web/src/pages/app/Requests.tsx`, ajustar os imports do topo:

```typescript
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Inbox, Search, X } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'
```

Dentro de `export default function Requests()`, logo após a declaração de `statusFilter` (linha `const [statusFilter, setStatusFilter] = useState<ClientRequest['status'] | ''>('PENDING')`), adicionar:

```typescript
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
```

Logo após a declaração de `const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({...})`, adicionar a lógica de filtragem:

```typescript
  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (search) {
        const q = search.toLowerCase()
        const matchesTitle = r.title.toLowerCase().includes(q)
        const matchesClient = (r.client?.name ?? '').toLowerCase().includes(q)
        if (!matchesTitle && !matchesClient) return false
      }
      if (dateFrom && new Date(r.createdAt) < new Date(dateFrom + 'T00:00:00')) return false
      if (dateTo && new Date(r.createdAt) > new Date(dateTo + 'T23:59:59')) return false
      return true
    })
  }, [requests, search, dateFrom, dateTo])

  const hasActiveFilter = !!search || !!dateFrom || !!dateTo
```

- [ ] **Step 2: Adicionar a barra de filtros na UI, abaixo do filtro de status existente**

Localizar o bloco do filtro de status (`<div className="flex rounded-md border border-gray-300 overflow-hidden w-fit"> ... </div>`, logo depois do `<h1>`) e adicionar imediatamente após o `</div>` de fechamento desse bloco:

```typescript
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por cliente ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-gray-200 focus:ring-[#185FA5]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-from" className="text-xs text-gray-500 whitespace-nowrap">De</Label>
          <Input
            id="req-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 border-gray-200"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-to" className="text-xs text-gray-500 whitespace-nowrap">Até</Label>
          <Input
            id="req-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 border-gray-200"
          />
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="h-9 px-2 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            <X size={13} />
            Limpar
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <p className="text-xs text-gray-400">
          {filtered.length === requests.length
            ? `${requests.length} solicitação${requests.length !== 1 ? 'ões' : ''}`
            : `Exibindo ${filtered.length} de ${requests.length}`}
        </p>
      )}
```

- [ ] **Step 3: Trocar as referências de `requests` por `filtered` na renderização da lista**

Localizar o bloco `{requests.length === 0 ? (...) : (<div className="space-y-2">{requests.map((r) => (...))}</div>)}` e trocar **apenas dentro desse bloco de renderização da lista** (não nos outros usos de `requests`, como o contador acima que compara `requests.length` com `filtered.length` de propósito):

```typescript
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {requests.length === 0 ? 'Nenhuma solicitação encontrada' : 'Nenhuma solicitação encontrada para este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
```

(o restante do `.map` interno permanece idêntico — só a fonte dos dados iterados muda de `requests` para `filtered`, e a mensagem de vazio fica mais específica quando há filtro ativo vs. lista realmente vazia).

- [ ] **Step 4: Verificar compilação**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: sem erros novos.

- [ ] **Step 5: Testar manualmente no navegador**

```bash
pnpm --filter api dev    # se ainda não estiver rodando
pnpm --filter web dev    # se ainda não estiver rodando
```

Login como `ORG_ADMIN`, ir em `/app/requests`, criar via portal (outra aba, como CLIENT) 2-3 solicitações com clientes/títulos diferentes. Confirmar: busca por nome de cliente filtra corretamente; busca por título filtra corretamente; filtro de período (`De`/`Até`) restringe pela data de criação; botão "Limpar" reseta os três filtros; contador "Exibindo X de Y" aparece só quando há filtro ativo.

- [ ] **Step 6: Rodar os testes do frontend**

```bash
pnpm --filter web test
```

Expected: mesma baseline (`TemplateEditor.test.tsx` 2/10 pré-existente, sem novas falhas — esta página não tem teste próprio hoje).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/app/Requests.tsx
git commit -m "feat(web): filtros de busca por cliente/título e período na lista de solicitações"
```

---

## Self-Review

- Badge em tempo real → Tasks 1 (infra SSE), 2 (disparo de evento), 3 (endpoints), 4 (hook), 5 (UI no menu). Cobertura completa do design.
- Filtros na lista → Task 6. Cobertura completa (busca por cliente/título + período, sem dropdown de cliente, conforme decidido).
- Ordem de rotas estáticas antes de `/:id` → resolvida explicitamente no Step 7b da Task 3, incluindo o problema de `/stream` precisar ficar fora do hook `verifyJWT` (descoberto ao detalhar a implementação — documentado inline, não é uma lacuna).
- Nenhum placeholder, nenhuma referência a função/tipo não definido em alguma task anterior do próprio plano.
- Fora de escopo (igual ao spec): paginação no `GET /requests`, dropdown de cliente, badge no portal do cliente.
