# SLA e Alertas de Prazo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o cron horário sem dedup (`TASK_DUE_DATE_APPROACHING`) por um sistema de alerta
de prazo em dois níveis (meta/vencimento) com badge visual no Kanban, push+som em tempo real
(navegador, só boards OS, customizável por usuário e por organização) e um digest diário único por
email/WhatsApp cobrindo OS + Recorrente.

**Architecture:** Nível de SLA é sempre derivado (função pura `computeSlaLevel`, nunca armazenado),
espelhada em backend e frontend. Push/som usa polling leve (React Query, ~60s) sobre dados já
existentes — sem SSE novo, sem Service Worker/VAPID. Digest diário é 1 job BullMQ novo que
substitui o cron antigo. Áudio: enum de sons do sistema + 1 slot de som customizado por
organização (upload B2), preferência de escolha/volume persistida por usuário no backend.

**Tech Stack:** Node 22 + TypeScript strict + Fastify v5 + Prisma v6 + BullMQ + Redis (backend);
React 19 + Vite + TailwindCSS v4 + shadcn/ui + React Query (frontend).

**Spec:** `docs/superpowers/specs/2026-10-08-sla-alertas-prazo-design.md`

## Global Constraints

- TypeScript `strict: true` — sem `any`, sem `as unknown` (exceto onde o padrão do projeto já usa
  `as` pontual para erros de terceiros, como em `attachments.routes.ts`).
- Validação Zod em toda entrada de borda (body, params, query).
- Erros via `AppError(statusCode, message)`.
- Logs via Pino — nunca `console.log` em produção (workers usam `console.log`/`console.error`
  pontualmente hoje — seguir o padrão já existente em `worker.ts`/`duedate.cron.ts`, não introduzir
  Pino novo fora do escopo).
- Migrations só via `pnpm --filter api migrate:dev -- --name <nome>` — nunca `prisma migrate` cru.
- Comentários e identificadores em inglês; mensagens de usuário (toasts, templates, UI) em
  português.
- Path alias `@/` → `src/` em ambos os apps.
- Ambiente é só de teste (produção descartável, confirmado em sessões anteriores) — não precisa de
  estratégia de migração de dado real, só o schema ficar correto daqui pra frente.

## Review Focus

- **Task sem `targetDate` nem `dueDate`:** `computeSlaLevel` deve retornar `'NONE'` sem lançar
  erro — tarefas recorrentes sem meta definida, ou tasks antigas sem nenhuma data, não podem
  quebrar o cálculo em lote do digest.
- **Task com `dueDate` no passado mas já `DONE`/`DISREGARDED`:** nunca deve gerar alerta — a
  query do digest e a query do polling de push devem excluir esses status, não só a função pura
  (que não tem acesso a status).
- **Usuário nunca concedeu nem negou permissão de notificação do navegador
  (`Notification.permission === 'default'`):** o banner de pedido de permissão deve aparecer uma
  vez, não a cada re-render do hook, e nunca chamar `requestPermission()` sem interação explícita
  do usuário.
- **Organização sem `customSlaSoundKey` configurado, mas um usuário com `ORG_CUSTOM` salvo como
  preferência (ex: admin removeu o som depois):** o frontend deve cair pro som padrão do sistema
  sem erro, nunca tentar buscar uma signed URL de uma key que não existe mais.
- **Digest com uma organização que tem `WHATSAPP` habilitado mas o usuário destinatário
  (`assignee`/admin) não tem `phone` cadastrado:** deve mandar só por EMAIL pra esse destinatário
  específico, sem falhar o job inteiro nem pular o EMAIL dele.

---

## Task 1: Schema — campos novos, enum e `UserSlaPreference`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: campos `NotificationConfig.slaTargetWarningDays`, `.slaDueCriticalDays`,
  `.slaDigestEnabled`, `.customSlaSoundKey`, `.customSlaSoundLabel`; remove
  `NotificationConfig.dueDateAlert`; enum `NotificationEvent` com `SLA_DIGEST` adicionado e
  `TASK_DUE_DATE_APPROACHING` removido; model `UserSlaPreference` novo.

- [ ] **Step 1: Editar `NotificationConfig`**

Em `apps/api/prisma/schema.prisma`, no model `NotificationConfig`, remover a linha
`dueDateAlert Boolean @default(true)` e adicionar, no mesmo bloco de campos:

```prisma
  slaTargetWarningDays Int      @default(3)
  slaDueCriticalDays    Int      @default(1)
  slaDigestEnabled      Boolean  @default(true)
  customSlaSoundKey     String?
  customSlaSoundLabel   String?
```

- [ ] **Step 2: Editar enum `NotificationEvent`**

Remover `TASK_DUE_DATE_APPROACHING` e adicionar `SLA_DIGEST`:

```prisma
enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_BLOCKED
  REQUEST_CREATED
  REQUEST_APPROVED
  REQUEST_REJECTED
  RECURRING_GENERATION_FAILED
  DOCUMENT_REJECTED
  SLA_DIGEST
}
```

- [ ] **Step 3: Adicionar model `UserSlaPreference`**

Adicionar, próximo ao model `User` (depois do bloco de `User`):

```prisma
model UserSlaPreference {
  id                  String   @id @default(cuid())
  userId              String   @unique
  targetWarningSound  String   @default("SOFT_PING")
  targetWarningVolume Int      @default(50)
  dueCriticalSound    String   @default("BELL")
  dueCriticalVolume   Int      @default(70)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_sla_preferences")
}
```

E no model `User`, adicionar a relação reversa (campo novo, sem `@relation` extra pois é 1:1):

```prisma
  slaPreference UserSlaPreference?
```

- [ ] **Step 4: Rodar a migration**

```bash
pnpm --filter api migrate:dev -- --name add_sla_alerts
```

Essa é uma mudança destrutiva de enum (remove `TASK_DUE_DATE_APPROACHING`): se existirem linhas em
`notification_logs` ou `message_templates` com `event = 'TASK_DUE_DATE_APPROACHING'`, o Postgres vai
falhar o cast ao recriar o tipo. **Antes de confirmar o nome da migration**, abra o arquivo SQL
gerado em `apps/api/prisma/migrations/<timestamp>_add_sla_alerts/migration.sql` e, se ele contiver
um bloco de recriação do enum `NotificationEvent` (`CREATE TYPE "NotificationEvent_new"` ou
similar), insira estas duas linhas **antes** desse bloco:

```sql
DELETE FROM "notification_logs" WHERE "event" = 'TASK_DUE_DATE_APPROACHING';
DELETE FROM "message_templates" WHERE "event" = 'TASK_DUE_DATE_APPROACHING';
```

Isso mantém a migration idempotente e segura para rodar em qualquer ambiente (produção também é
descartável aqui, mas o padrão correto é a migration já vir com a limpeza, não depender de alguém
truncar manualmente antes).

- [ ] **Step 5: Verificar e commitar**

```bash
pnpm --filter api exec tsc --noEmit
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(sla): adiciona campos de configuração de SLA e UserSlaPreference"
```

---

## Task 2: `src/lib/sla.ts` — função pura de cálculo de nível

**Files:**
- Create: `apps/api/src/lib/sla.ts`
- Test: `apps/api/src/lib/sla.test.ts`

**Interfaces:**
- Produces: `SlaLevel` (`'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'`), `SlaConfig` (`{
  slaTargetWarningDays: number; slaDueCriticalDays: number }`), `computeSlaLevel(targetDate: Date |
  null, dueDate: Date | null, now: Date, config: SlaConfig): SlaLevel`.

- [ ] **Step 1: Escrever os testes**

```typescript
// apps/api/src/lib/sla.test.ts
import { describe, it, expect } from 'vitest'
import { computeSlaLevel, type SlaConfig } from './sla'

const config: SlaConfig = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

describe('computeSlaLevel', () => {
  it('retorna NONE quando não há targetDate nem dueDate', () => {
    expect(computeSlaLevel(null, null, new Date('2026-10-08'), config)).toBe('NONE')
  })

  it('retorna NONE quando a data de referência ainda está fora da janela de aviso', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-10T00:00:00Z') // 10 dias antes, janela é 3
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('NONE')
  })

  it('retorna TARGET_WARNING ao cruzar a janela de aviso da meta', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-17T00:00:00Z') // exatamente 3 dias antes
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })

  it('retorna DUE_CRITICAL ao cruzar a janela crítica do vencimento', () => {
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T00:00:00Z') // 1 dia antes
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('prioriza DUE_CRITICAL quando ambos os níveis se aplicam ao mesmo tempo', () => {
    const targetDate = new Date('2026-10-15T00:00:00Z')
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T00:00:00Z') // já passou a meta (warning) e está crítico
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna DUE_CRITICAL mesmo depois do vencimento ter passado (tarefa atrasada)', () => {
    const dueDate = new Date('2026-10-01T00:00:00Z')
    const now = new Date('2026-10-08T00:00:00Z')
    expect(computeSlaLevel(null, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('respeita thresholds customizados por organização', () => {
    const custom: SlaConfig = { slaTargetWarningDays: 10, slaDueCriticalDays: 5 }
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-11T00:00:00Z') // 9 dias antes, dentro da janela de 10
    expect(computeSlaLevel(targetDate, null, now, custom)).toBe('TARGET_WARNING')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha** (`computeSlaLevel` ainda não existe)

```bash
pnpm --filter api exec vitest run src/lib/sla.test.ts
```

Esperado: falha de import/compilação.

- [ ] **Step 3: Implementar**

```typescript
// apps/api/src/lib/sla.ts
export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

function subtractDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

// DUE_CRITICAL tem prioridade sobre TARGET_WARNING quando ambos os níveis se aplicam ao mesmo
// tempo — o vencimento real é sempre mais urgente que a meta interna do escritório.
export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  if (dueDate && now >= subtractDaysUTC(dueDate, config.slaDueCriticalDays)) {
    return 'DUE_CRITICAL'
  }
  if (targetDate && now >= subtractDaysUTC(targetDate, config.slaTargetWarningDays)) {
    return 'TARGET_WARNING'
  }
  return 'NONE'
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api exec vitest run src/lib/sla.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sla.ts apps/api/src/lib/sla.test.ts
git commit -m "feat(sla): adiciona computeSlaLevel (função pura de nível de alerta)"
```

---

## Task 3: Backend — config de SLA em `notifications` (schema + service + rotas)

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Modify: `apps/api/src/modules/notifications/notifications.routes.test.ts`

**Interfaces:**
- Consumes: campos do schema de `Task 1` (`slaTargetWarningDays`, `slaDueCriticalDays`,
  `slaDigestEnabled`).
- Produces: `updateConfigSchema` aceita os 3 campos novos; `getConfig` os retorna; `dueDateAlert`
  removido de ambos.

- [ ] **Step 1: `notifications.schema.ts`**

Em `updateConfigSchema`, remover a linha `dueDateAlert: z.boolean().optional(),` e adicionar:

```typescript
  slaTargetWarningDays: z.number().int().min(0).max(90).optional(),
  slaDueCriticalDays: z.number().int().min(0).max(90).optional(),
  slaDigestEnabled: z.boolean().optional(),
```

- [ ] **Step 2: `notifications.service.ts`**

No `select` de `getConfig`, remover `dueDateAlert: true,` e adicionar, no mesmo bloco:

```typescript
      slaTargetWarningDays: true,
      slaDueCriticalDays: true,
      slaDigestEnabled: true,
```

- [ ] **Step 3: Teste de round-trip**

Em `notifications.routes.test.ts`, adicionar (mesmo padrão dos testes existentes no arquivo):

```typescript
  it('persiste thresholds de SLA e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { slaTargetWarningDays: 5, slaDueCriticalDays: 2, slaDigestEnabled: false },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    expect(getRes.statusCode).toBe(200)
    const body = JSON.parse(getRes.body)
    expect(body.slaTargetWarningDays).toBe(5)
    expect(body.slaDueCriticalDays).toBe(2)
    expect(body.slaDigestEnabled).toBe(false)
  })
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter api exec vitest run src/modules/notifications
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications
git commit -m "feat(sla): expõe thresholds de SLA em NotificationConfig"
```

---

## Task 4: Backend — upload/remoção de som customizado da organização

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.routes.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Create: `apps/api/src/modules/notifications/notifications.sla-sound.test.ts`

**Interfaces:**
- Consumes: `uploadFile`, `deleteFile` de `@/lib/b2`.
- Produces: `POST /notifications/config/sla-sound` (multipart, `ORG_ADMIN`), `DELETE
  /notifications/config/sla-sound`.

- [ ] **Step 1: `notifications.service.ts` — funções de upload/remoção**

Adicionar ao final do arquivo:

```typescript
import { uploadFile, deleteFile } from '@/lib/b2'

const SLA_SOUND_MAX_SIZE = 500 * 1024
const SLA_SOUND_ALLOWED_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav'])

export function isAllowedSlaSoundType(mimeType: string): boolean {
  return SLA_SOUND_ALLOWED_TYPES.has(mimeType)
}

export const SLA_SOUND_MAX_SIZE_BYTES = SLA_SOUND_MAX_SIZE

export async function uploadSlaSound(
  organizationId: string,
  file: { buffer: Buffer; mimeType: string; label: string },
): Promise<void> {
  const key = `sla-sounds/${organizationId}.mp3`
  await uploadFile(key, file.buffer, file.mimeType)
  await prisma.notificationConfig.update({
    where: { organizationId },
    data: { customSlaSoundKey: key, customSlaSoundLabel: file.label },
  })
}

export async function deleteSlaSound(organizationId: string): Promise<void> {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.customSlaSoundKey) return
  await deleteFile(config.customSlaSoundKey)
  await prisma.notificationConfig.update({
    where: { organizationId },
    data: { customSlaSoundKey: null, customSlaSoundLabel: null },
  })
}
```

(O import `uploadFile, deleteFile` vai junto dos imports existentes no topo do arquivo, não
duplicado no meio — ajustar a posição ao editar.)

- [ ] **Step 2: `notifications.routes.ts` — rotas**

Adicionar o import de `multipart` e registrar o plugin, mais as duas rotas novas. O hook de
`requireRole('ORG_ADMIN')` já está no topo do arquivo (`app.addHook('preHandler',
requireRole('ORG_ADMIN'))`), então essas rotas já nascem restritas a admin — não precisa repetir.

```typescript
import multipart from '@fastify/multipart'
// ...outros imports...
import { uploadSlaSound, deleteSlaSound, isAllowedSlaSoundType, SLA_SOUND_MAX_SIZE_BYTES } from './notifications.service'

export async function notificationsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: SLA_SOUND_MAX_SIZE_BYTES } })
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  // ...rotas existentes...

  app.post('/config/sla-sound', { preHandler: [checkSubscription] }, async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 500KB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')
    if (!isAllowedSlaSoundType(file.mimetype)) {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Tipo de arquivo não permitido — use MP3 ou WAV')
    }

    const buffer = await file.toBuffer()
    if (buffer.length > SLA_SOUND_MAX_SIZE_BYTES) throw new AppError(413, 'Arquivo excede o limite de 500KB')

    const label = (request.body as { label?: string } | undefined)?.label ?? file.filename
    await uploadSlaSound(request.user.organizationId!, { buffer, mimeType: file.mimetype, label })
    return reply.status(201).send({ ok: true })
  })

  app.delete('/config/sla-sound', { preHandler: [checkSubscription] }, async (request, reply) => {
    await deleteSlaSound(request.user.organizationId!)
    return reply.status(204).send()
  })
}
```

> Nota: campos de texto (`label`) em multipart chegam via `request.body` só se o client mandar
> como campo de formulário antes do arquivo — confirmar no teste que o fastify/multipart está
> populando `request.body.label` corretamente (o padrão do fastify/multipart é expor campos não-
> arquivo em `request.body` quando `attachFieldsToBody` não está desabilitado, que é o default).

- [ ] **Step 3: Teste**

```typescript
// apps/api/src/modules/notifications/notifications.sla-sound.test.ts
import { describe, it, expect, vi } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/b2', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/test.mp3'),
}))

describe('POST/DELETE /notifications/config/sla-sound', () => {
  it('faz upload, persiste a key e depois remove', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const form = Buffer.from('fake-mp3-bytes')
    const boundary = '----testboundary'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="aviso.mp3"\r\n' +
      'Content-Type: audio/mpeg\r\n\r\n' +
      `${form.toString('binary')}\r\n` +
      `--${boundary}--\r\n`

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(uploadRes.statusCode).toBe(201)

    const config = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(config?.customSlaSoundKey).toBe(`sla-sounds/${org.id}.mp3`)

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/notifications/config/sla-sound',
      headers: { authorization: auth },
    })
    expect(deleteRes.statusCode).toBe(204)

    const configAfter = await prisma.notificationConfig.findUnique({ where: { organizationId: org.id } })
    expect(configAfter?.customSlaSoundKey).toBeNull()
  })

  it('rejeita tipo de arquivo não permitido', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const boundary = '----testboundary2'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="virus.exe"\r\n' +
      'Content-Type: application/x-msdownload\r\n\r\n' +
      'bytes\r\n' +
      `--${boundary}--\r\n`

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/config/sla-sound',
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(422)
  })
})
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter api exec vitest run src/modules/notifications
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications
git commit -m "feat(sla): upload e remoção de som customizado da organização"
```

---

## Task 5: Backend — módulo `sla` (config público + preferência do usuário)

**Files:**
- Create: `apps/api/src/modules/sla/sla.schema.ts`
- Create: `apps/api/src/modules/sla/sla.service.ts`
- Create: `apps/api/src/modules/sla/sla.routes.ts`
- Create: `apps/api/src/modules/sla/sla.routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `getSignedDownloadUrl` de `@/lib/b2`; `UserSlaPreference` do schema (Task 1).
- Produces: `GET /sla/config`, `GET /sla/custom-sound-url`, `GET /sla/preferences`, `PATCH
  /sla/preferences` — acessíveis a `ORG_ADMIN`, `ORG_MANAGER`, `ORG_MEMBER` (diferente do módulo
  `notifications`, que é restrito a `ORG_ADMIN`).

- [ ] **Step 1: `sla.schema.ts`**

```typescript
// apps/api/src/modules/sla/sla.schema.ts
import { z } from 'zod'

const SOUND_OPTIONS = ['CHIME', 'BELL', 'SOFT_PING', 'MUTE', 'ORG_CUSTOM'] as const

export const updateSlaPreferenceSchema = z.object({
  targetWarningSound: z.enum(SOUND_OPTIONS).optional(),
  targetWarningVolume: z.number().int().min(0).max(100).optional(),
  dueCriticalSound: z.enum(SOUND_OPTIONS).optional(),
  dueCriticalVolume: z.number().int().min(0).max(100).optional(),
})

export type UpdateSlaPreferenceBody = z.infer<typeof updateSlaPreferenceSchema>
```

- [ ] **Step 2: `sla.service.ts`**

```typescript
// apps/api/src/modules/sla/sla.service.ts
import { prisma } from '@/lib/prisma'
import { getSignedDownloadUrl } from '@/lib/b2'
import type { UpdateSlaPreferenceBody } from './sla.schema'

export async function getPublicSlaConfig(organizationId: string) {
  const config = await prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: {
      slaTargetWarningDays: true,
      slaDueCriticalDays: true,
      customSlaSoundLabel: true,
      customSlaSoundKey: true,
    },
  })
  return {
    slaTargetWarningDays: config?.slaTargetWarningDays ?? 3,
    slaDueCriticalDays: config?.slaDueCriticalDays ?? 1,
    hasCustomSound: !!config?.customSlaSoundKey,
    customSlaSoundLabel: config?.customSlaSoundLabel ?? null,
  }
}

export async function getCustomSoundUrl(organizationId: string): Promise<string | null> {
  const config = await prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: { customSlaSoundKey: true },
  })
  if (!config?.customSlaSoundKey) return null
  return getSignedDownloadUrl(config.customSlaSoundKey)
}

export async function getSlaPreference(userId: string) {
  const existing = await prisma.userSlaPreference.findUnique({ where: { userId } })
  if (existing) return existing
  // Cria com defaults na primeira leitura — evita exigir um passo de "setup inicial" no onboarding.
  return prisma.userSlaPreference.create({ data: { userId } })
}

export async function updateSlaPreference(userId: string, data: UpdateSlaPreferenceBody) {
  await getSlaPreference(userId) // garante que a linha existe antes do update
  return prisma.userSlaPreference.update({ where: { userId }, data })
}
```

- [ ] **Step 3: `sla.routes.ts`**

```typescript
// apps/api/src/modules/sla/sla.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { updateSlaPreferenceSchema } from './sla.schema'
import {
  getPublicSlaConfig,
  getCustomSoundUrl,
  getSlaPreference,
  updateSlaPreference,
} from './sla.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function slaRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole(...ORG_ROLES))

  app.get('/config', async (request, reply) => {
    return reply.send(await getPublicSlaConfig(request.user.organizationId!))
  })

  app.get('/custom-sound-url', async (request, reply) => {
    return reply.send({ url: await getCustomSoundUrl(request.user.organizationId!) })
  })

  app.get('/preferences', async (request, reply) => {
    return reply.send(await getSlaPreference(request.user.sub))
  })

  app.patch('/preferences', async (request, reply) => {
    const result = updateSlaPreferenceSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateSlaPreference(request.user.sub, result.data))
  })
}
```

- [ ] **Step 4: Registrar em `server.ts`**

Adicionar o import e o registro, junto dos outros módulos:

```typescript
import { slaRoutes } from '@/modules/sla/sla.routes'
// ...
app.register(slaRoutes, { prefix: '/sla' })
```

- [ ] **Step 5: Teste**

```typescript
// apps/api/src/modules/sla/sla.routes.test.ts
import { describe, it, expect, vi } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

vi.mock('@/lib/b2', () => ({
  getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/sound.mp3'),
}))

describe('GET /sla/config', () => {
  it('retorna defaults quando a org nunca configurou', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({ method: 'GET', url: '/sla/config', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.slaTargetWarningDays).toBe(3)
    expect(body.slaDueCriticalDays).toBe(1)
    expect(body.hasCustomSound).toBe(false)
  })

  it('é acessível por ORG_MEMBER (não exige ORG_ADMIN)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({ method: 'GET', url: '/sla/config', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET/PATCH /sla/preferences', () => {
  it('cria com defaults na primeira leitura e persiste updates', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const getRes = await app.inject({ method: 'GET', url: '/sla/preferences', headers: { authorization: auth } })
    expect(getRes.statusCode).toBe(200)
    expect(JSON.parse(getRes.body).targetWarningSound).toBe('SOFT_PING')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/sla/preferences',
      headers: { authorization: auth },
      payload: { targetWarningSound: 'MUTE', dueCriticalVolume: 90 },
    })
    expect(patchRes.statusCode).toBe(200)
    const body = JSON.parse(patchRes.body)
    expect(body.targetWarningSound).toBe('MUTE')
    expect(body.dueCriticalVolume).toBe(90)
  })
})
```

- [ ] **Step 6: Rodar os testes e typecheck**

```bash
pnpm --filter api exec vitest run src/modules/sla
pnpm --filter api exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/sla apps/api/src/server.ts
git commit -m "feat(sla): módulo sla — config público e preferência de som por usuário"
```

---

## Task 6: Backend — templates (`default-templates.ts` + `template.ts`)

**Files:**
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/lib/template.ts`

**Interfaces:**
- Produces: entrada `SLA_DIGEST` em `DEFAULT_TEMPLATES`; `TemplateVars` ganha `taskCount`,
  `criticalCount`, `taskListText`; entrada `TASK_DUE_DATE_APPROACHING` removida de ambos.

- [ ] **Step 1: `default-templates.ts`**

Remover o bloco `TASK_DUE_DATE_APPROACHING: { ... }` inteiro e adicionar no lugar:

```typescript
  SLA_DIGEST: {
    WHATSAPP: { body: 'Olá! Você tem {{taskCount}} tarefa(s) com prazo próximo, sendo {{criticalCount}} crítica(s).\n\n{{taskListText}}\n\nAcesse: {{portalUrl}}' },
    EMAIL: {
      subject: 'Resumo de prazos — {{taskCount}} tarefa(s) em alerta',
      body: 'Olá!\n\nVocê tem {{taskCount}} tarefa(s) com prazo próximo, sendo {{criticalCount}} crítica(s):\n\n{{taskListText}}\n\nAcesse o painel: {{portalUrl}}',
    },
  },
```

- [ ] **Step 2: `template.ts`**

No `interface TemplateVars`, remover nada (não existia campo específico pro due date approaching
além dos já genéricos) e adicionar:

```typescript
  taskCount?: string       // novo — quantidade total de tarefas em alerta (SLA_DIGEST)
  criticalCount?: string   // novo — quantidade em nível crítico (SLA_DIGEST)
  taskListText?: string    // novo — lista formatada em texto simples, uma tarefa por linha (SLA_DIGEST)
```

No `PREVIEW_VARS`, adicionar:

```typescript
  taskCount: '3',
  criticalCount: '1',
  taskListText: '- Abertura de LTDA (João Silva) — vence 20/10/2026 [crítico]\n- Folha de pagamento (Maria Souza) — meta 25/10/2026 [atenção]',
```

- [ ] **Step 3: Verificar**

```bash
pnpm --filter api exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/default-templates.ts apps/api/src/lib/template.ts
git commit -m "feat(sla): template padrão e variáveis do evento SLA_DIGEST"
```

---

## Task 7: Backend — `notification.worker.ts` (EVENT_FLAG_MAP + digest por usuário com WhatsApp)

**Files:**
- Modify: `apps/api/src/workers/notification.worker.ts`
- Modify: `apps/api/src/workers/notification.worker.test.ts`

**Interfaces:**
- Consumes: `NotificationJob.channels` (já existe em `@/lib/queue`).
- Produces: `EVENT_FLAG_MAP` com `SLA_DIGEST: 'slaDigestEnabled'` (sem `TASK_DUE_DATE_APPROACHING`);
  `processUserNotification` passa a aceitar `channels` e enviar WHATSAPP quando `user.phone`
  existir e o canal estiver habilitado.

- [ ] **Step 1: `EVENT_FLAG_MAP`**

Remover a linha `TASK_DUE_DATE_APPROACHING: 'dueDateAlert',` e adicionar:

```typescript
  SLA_DIGEST: 'slaDigestEnabled',
```

- [ ] **Step 2: Threading de `channels` até `processUserNotification`**

Em `processNotificationJob`, no branch `if (recipientType === 'USER')`, passar `channels` adiante:

```typescript
  if (recipientType === 'USER') {
    if (!userId) return
    await processUserNotification(config, { event, organizationId, userId, taskId, requestId, metadata, channels })
    return
  }
```

- [ ] **Step 3: Extender `processUserNotification`**

Substituir a assinatura e o corpo da função por:

```typescript
async function processUserNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    userId: string
    taskId?: string
    requestId?: string
    metadata: Record<string, string | undefined>
    channels?: MessageChannel[]
  },
): Promise<void> {
  const { event, organizationId, userId, taskId, requestId, metadata, channels: channelOverride } = params

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!user || !org || user.organizationId !== organizationId) return

  const appUrl = process.env.APP_URL ?? 'https://tramita.autohubs.com.br'
  const vars: TemplateVars = {
    clientName: metadata.clientName ?? '',
    orgName: org.name,
    taskTitle: metadata.taskTitle,
    requestTitle: metadata.requestTitle,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
    taskCount: metadata.taskCount,
    criticalCount: metadata.criticalCount,
    taskListText: metadata.taskListText,
    portalUrl: event === 'TASK_COMMENT_ADDED' ? `${appUrl}/app` : `${appUrl}/app/requests`,
  }

  const availableChannels: MessageChannel[] = []
  if (config.emailEnabled) availableChannels.push('EMAIL')
  if (config.whatsappEnabled && config.maximizebotToken && user.phone) availableChannels.push('WHATSAPP')
  const effectiveChannels = channelOverride ? availableChannels.filter((c) => channelOverride.includes(c)) : availableChannels

  for (const channel of effectiveChannels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)

    let status: 'SENT' | 'FAILED' = 'SENT'
    let error: string | undefined
    let recipient: string

    try {
      if (channel === 'EMAIL') {
        recipient = user.email
        const subject = renderTemplate(template.subject ?? '', vars)
        await sendEmail(user.email, subject, rendered, wrapEmailHtml(subject, rendered, vars.portalUrl, 'Ver no painel'))
      } else {
        recipient = user.phone!
        await sendWhatsApp(config.maximizebotToken!, {
          number: user.phone!,
          body: rendered,
          saveOnTicket: config.saveOnTicket,
          startChatbot: config.startChatbot,
          linkPreview: true,
        })
      }
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
      recipient = channel === 'EMAIL' ? user.email : (user.phone ?? '')
    }

    await prisma.notificationLog.create({
      data: {
        organizationId,
        event: event as NotificationEvent,
        channel,
        taskId,
        requestId,
        recipient,
        message: rendered,
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
}
```

(Isso é compatível com os eventos `USER` já existentes — `TASK_COMMENT_ADDED`/requests — que só
tinham EMAIL habilitado; eles continuam funcionando igual, porque `config.whatsappEnabled &&
config.maximizebotToken && user.phone` é adicional, não substitui o EMAIL.)

- [ ] **Step 4: Atualizar o teste existente que usava `TASK_DUE_DATE_APPROACHING`**

Buscar em `notification.worker.test.ts` por `TASK_DUE_DATE_APPROACHING` (se houver) e trocar por
`TASK_MOVED` ou remover o teste equivalente, já que o evento não existe mais — seguir o padrão já
usado nesse arquivo para os demais eventos.

- [ ] **Step 5: Teste novo — digest por usuário com WhatsApp**

Adicionar em `notification.worker.test.ts`:

```typescript
describe('processNotificationJob — SLA_DIGEST por usuário', () => {
  it('envia por EMAIL e WHATSAPP quando o usuário tem phone e a org tem WhatsApp configurado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.update({
      where: { organizationId: org.id },
      data: { whatsappEnabled: true, maximizebotToken: 'Bearer test-token', slaDigestEnabled: true },
    })
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN', phone: '5511999999999' })

    await processNotificationJob({
      data: {
        event: 'SLA_DIGEST',
        organizationId: org.id,
        recipientType: 'USER',
        userId: user.id,
        metadata: { taskCount: '2', criticalCount: '1', taskListText: '- Tarefa X — crítico' },
      },
    })

    const logs = await prisma.notificationLog.findMany({ where: { organizationId: org.id, event: 'SLA_DIGEST' } })
    expect(logs.map((l) => l.channel).sort()).toEqual(['EMAIL', 'WHATSAPP'])
  })

  it('envia só por EMAIL quando o usuário não tem phone cadastrado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.update({
      where: { organizationId: org.id },
      data: { whatsappEnabled: true, maximizebotToken: 'Bearer test-token' },
    })
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' }) // sem phone

    await processNotificationJob({
      data: {
        event: 'SLA_DIGEST',
        organizationId: org.id,
        recipientType: 'USER',
        userId: user.id,
        metadata: { taskCount: '1', criticalCount: '0', taskListText: '- Tarefa Y — atenção' },
      },
    })

    const logs = await prisma.notificationLog.findMany({ where: { organizationId: org.id, event: 'SLA_DIGEST' } })
    expect(logs.map((l) => l.channel)).toEqual(['EMAIL'])
  })
})
```

> Nota: se `createTestUser` não aceitar `phone` como override hoje, estender a assinatura do
> helper em `apps/api/src/test/helpers.ts` para aceitar `phone` opcional — checar a implementação
> atual antes de assumir.

- [ ] **Step 6: Rodar os testes**

```bash
pnpm --filter api exec vitest run src/workers
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workers apps/api/src/test/helpers.ts
git commit -m "feat(sla): worker de notificação suporta digest por usuário via EMAIL+WHATSAPP"
```

---

## Task 8: Backend — `sla-digest.cron.ts` (substitui `duedate.cron.ts`)

**Files:**
- Create: `apps/api/src/workers/sla-digest.cron.ts`
- Create: `apps/api/src/workers/sla-digest.cron.test.ts`
- Delete: `apps/api/src/workers/duedate.cron.ts`
- Delete: `apps/api/src/workers/duedate.cron.test.ts` (se existir — confirmar nome exato do arquivo
  de teste do cron antigo antes de remover)
- Modify: `apps/api/src/worker.ts`

**Interfaces:**
- Consumes: `computeSlaLevel` (Task 2), `enqueueNotification` (`@/lib/queue`).
- Produces: `runSlaDigest(now?: Date): Promise<void>` (função exportada testável
  independentemente do cron, mesmo padrão de `runRecurringTasksGeneration` em
  `recurring-tasks.cron.ts`), `startSlaDigestCronWorker()`.

- [ ] **Step 1: Implementar `sla-digest.cron.ts`**

```typescript
// apps/api/src/workers/sla-digest.cron.ts
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'

interface DigestEntry {
  taskTitle: string
  clientName: string
  level: SlaLevel
  dateLabel: string
}

function formatTaskLine(entry: DigestEntry): string {
  const tag = entry.level === 'DUE_CRITICAL' ? 'crítico' : 'atenção'
  return `- ${entry.taskTitle} (${entry.clientName}) — ${entry.dateLabel} [${tag}]`
}

export async function runSlaDigest(now: Date = new Date()): Promise<void> {
  const orgs = await prisma.organization.findMany({
    include: { notificationConfig: true },
  })

  for (const org of orgs) {
    if (org.notificationConfig?.slaDigestEnabled === false) continue

    const config = {
      slaTargetWarningDays: org.notificationConfig?.slaTargetWarningDays ?? 3,
      slaDueCriticalDays: org.notificationConfig?.slaDueCriticalDays ?? 1,
    }

    const tasks = await prisma.task.findMany({
      where: {
        status: { notIn: ['DONE', 'DISREGARDED'] },
        column: { board: { organizationId: org.id, isActive: true } },
        OR: [{ targetDate: { not: null } }, { dueDate: { not: null } }],
      },
      select: {
        id: true,
        title: true,
        targetDate: true,
        dueDate: true,
        assignee: { select: { id: true } },
        column: { select: { board: { select: { client: { select: { name: true } } } } } },
      },
    })

    const admins = await prisma.user.findMany({
      where: { organizationId: org.id, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] } },
      select: { id: true },
    })

    const byUserId = new Map<string, DigestEntry[]>()

    for (const task of tasks) {
      const level = computeSlaLevel(task.targetDate, task.dueDate, now, config)
      if (level === 'NONE') continue

      const entry: DigestEntry = {
        taskTitle: task.title,
        clientName: task.column.board.client.name,
        level,
        dateLabel: level === 'DUE_CRITICAL'
          ? `vence ${task.dueDate!.toLocaleDateString('pt-BR')}`
          : `meta ${task.targetDate!.toLocaleDateString('pt-BR')}`,
      }

      const recipientIds = task.assignee ? [task.assignee.id] : admins.map((a) => a.id)
      for (const userId of recipientIds) {
        const bucket = byUserId.get(userId) ?? []
        bucket.push(entry)
        byUserId.set(userId, bucket)
      }
    }

    for (const [userId, entries] of byUserId) {
      const criticalCount = entries.filter((e) => e.level === 'DUE_CRITICAL').length
      await enqueueNotification({
        event: 'SLA_DIGEST',
        organizationId: org.id,
        recipientType: 'USER',
        userId,
        metadata: {
          taskCount: String(entries.length),
          criticalCount: String(criticalCount),
          taskListText: entries.map(formatTaskLine).join('\n'),
        },
      })
    }
  }
}

export async function startSlaDigestCronWorker() {
  const cronQueue = new Queue('sla-digest-cron', { connection: bullmqRedis })

  await cronQueue.add('check', {}, {
    repeat: { pattern: '0 8 * * *' },
    jobId: 'sla-digest-check',
  })

  return new Worker('sla-digest-cron', async () => {
    await runSlaDigest()
  }, { connection: bullmqRedis })
}
```

- [ ] **Step 2: Remover o cron antigo**

```bash
rm apps/api/src/workers/duedate.cron.ts
# Confirmar o nome exato do teste antigo antes de remover:
ls apps/api/src/workers/ | grep -i duedate
rm apps/api/src/workers/duedate.cron.test.ts  # ajustar nome se diferente
```

- [ ] **Step 3: Atualizar `worker.ts`**

```typescript
import { startNotificationWorker } from '@/workers/notification.worker'
import { startSlaDigestCronWorker } from '@/workers/sla-digest.cron'
import { startRecurringTasksCronWorker } from '@/workers/recurring-tasks.cron'

async function main() {
  startNotificationWorker()
  await startSlaDigestCronWorker()
  await startRecurringTasksCronWorker()
  console.log('[worker] Notification worker + SLA digest cron + recurring tasks cron iniciados')
}
```

- [ ] **Step 4: Teste**

```typescript
// apps/api/src/workers/sla-digest.cron.test.ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard, createTestColumn, createTestTask } from '@/test/helpers'
import { runSlaDigest } from './sla-digest.cron'

vi.mock('@/lib/queue', () => ({ enqueueNotification: vi.fn().mockResolvedValue(undefined) }))

describe('runSlaDigest', () => {
  it('enfileira digest pro assignee quando a task está em alerta', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const assignee = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, { departmentId: (await import('@/test/helpers')).createTestDepartment ? undefined : undefined })

    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1) // dentro da janela crítica padrão (1 dia)
    await prisma.task.update({ where: { id: task.id }, data: { dueDate, assigneeId: assignee.id } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SLA_DIGEST', userId: assignee.id }),
    )
  })

  it('não enfileira nada quando nenhuma task está em alerta', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    vi.mocked(enqueueNotification).mockClear()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const farDueDate = new Date()
    farDueDate.setUTCDate(farDueDate.getUTCDate() + 60)
    await createTestTask(column.id, {})
    const task = await prisma.task.findFirst({ where: { columnId: column.id } })
    await prisma.task.update({ where: { id: task!.id }, data: { dueDate: farDueDate } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })

  it('não enfileira nada quando slaDigestEnabled está desligado', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    vi.mocked(enqueueNotification).mockClear()
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.update({ where: { organizationId: org.id }, data: { slaDigestEnabled: false } })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, {})
    const dueDate = new Date()
    await prisma.task.update({ where: { id: task.id }, data: { dueDate } })

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalled()
  })
})
```

> Nota: as assinaturas exatas de `createTestClient`/`createTestBoard`/`createTestColumn`/
> `createTestTask` precisam ser confirmadas lendo `apps/api/src/test/helpers.ts` antes de escrever
> o teste final — os parâmetros acima (`departmentId`, overrides) são indicativos; ajustar para a
> assinatura real do helper existente, seguindo o mesmo padrão usado em
> `recurring-tasks.cron.test.ts` para montar board/column/task de teste.

- [ ] **Step 5: Rodar os testes**

```bash
pnpm --filter api exec vitest run src/workers/sla-digest.cron.test.ts
pnpm --filter api test
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers apps/api/src/worker.ts
git commit -m "feat(sla): substitui duedate.cron por sla-digest.cron (1x/dia, sem repetição)"
```

---

## Task 9: Backend — filtro `boardType`/`openOnly` em `GET /tasks`

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.test.ts` (ou arquivo de teste equivalente de
  `listTasks` — confirmar nome exato)

**Interfaces:**
- Produces: `listTasksQuerySchema` com `boardType` e `openOnly`; `listTasks` aplica os dois
  filtros no `where`.

- [ ] **Step 1: `tasks.schema.ts`**

Em `listTasksQuerySchema`, adicionar:

```typescript
  boardType: z.enum(['OS', 'RECURRING_SYSTEM']).optional(),
  openOnly: z.coerce.boolean().optional(),
```

- [ ] **Step 2: `tasks.service.ts`**

No `where` de `listTasks`, adicionar:

```typescript
    ...(query.boardType ? { column: { board: { organizationId, type: query.boardType, ...(query.clientId ? { clientId: query.clientId } : {}) } } } : {}),
    ...(query.openOnly ? { status: { notIn: ['DONE', 'DISREGARDED'] } } : {}),
```

> Atenção: hoje `where.column.board` já é montado uma vez no topo do objeto (com
> `organizationId` e `clientId` opcional). Ao adicionar `boardType`, a forma correta é **mesclar**
> no mesmo objeto `column.board`, não duplicar a chave `column` — ajustar a estrutura existente em
> vez de colar o trecho acima literalmente se o formato do `where` já tiver mudado desde a leitura
> original deste plano. O objetivo final é um único `where.column.board = { organizationId,
> ...(clientId), ...(type) }`.

Também ajustar: se `query.status` já foi passado explicitamente, `openOnly` não deve sobrescrevê-lo
silenciosamente — usar `query.status ? { status: query.status } : query.openOnly ? { status: {
notIn: [...] } } : {}` como uma única entrada no `where`, não duas chaves `status` conflitantes.

- [ ] **Step 3: Teste**

Adicionar um teste de `listTasks` confirmando que `boardType: 'OS'` exclui tasks de board
`RECURRING_SYSTEM` e que `openOnly: true` exclui `DONE`/`DISREGARDED` — seguir o padrão de testes
já existente no arquivo de teste de `tasks.service`.

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter api exec vitest run src/modules/tasks
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tasks
git commit -m "feat(sla): GET /tasks aceita filtro boardType e openOnly"
```

---

## Task 10: Frontend — `src/lib/sla.ts` (espelho) + tipos

**Files:**
- Create: `apps/web/src/lib/sla.ts`
- Create: `apps/web/src/lib/sla.test.ts`
- Modify: `apps/web/src/types/index.ts`

**Interfaces:**
- Produces: `computeSlaLevel` idêntica à versão backend (Task 2); `Board.type` adicionado ao tipo
  `Board`.

- [ ] **Step 1: Adicionar `type` ao tipo `Board`**

Em `apps/web/src/types/index.ts`, no `interface Board`, adicionar:

```typescript
  type: 'OS' | 'RECURRING_SYSTEM'
```

- [ ] **Step 2: Implementar `apps/web/src/lib/sla.ts`**

Código idêntico ao `apps/api/src/lib/sla.ts` (Task 2) — mesma função, mesmos tipos, sem import de
Prisma nem de nada do backend (é uma função pura standalone):

```typescript
// apps/web/src/lib/sla.ts
export type SlaLevel = 'NONE' | 'TARGET_WARNING' | 'DUE_CRITICAL'

export interface SlaConfig {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

function subtractDaysUTC(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  result.setUTCDate(result.getUTCDate() - days)
  return result
}

export function computeSlaLevel(
  targetDate: Date | null,
  dueDate: Date | null,
  now: Date,
  config: SlaConfig,
): SlaLevel {
  if (dueDate && now >= subtractDaysUTC(dueDate, config.slaDueCriticalDays)) {
    return 'DUE_CRITICAL'
  }
  if (targetDate && now >= subtractDaysUTC(targetDate, config.slaTargetWarningDays)) {
    return 'TARGET_WARNING'
  }
  return 'NONE'
}
```

- [ ] **Step 3: Teste (mesmos casos do backend)**

```typescript
// apps/web/src/lib/sla.test.ts
import { describe, it, expect } from 'vitest'
import { computeSlaLevel, type SlaConfig } from './sla'

const config: SlaConfig = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

describe('computeSlaLevel (frontend mirror)', () => {
  it('retorna NONE sem datas', () => {
    expect(computeSlaLevel(null, null, new Date(), config)).toBe('NONE')
  })

  it('prioriza DUE_CRITICAL sobre TARGET_WARNING', () => {
    const targetDate = new Date('2026-10-15T00:00:00Z')
    const dueDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-19T00:00:00Z')
    expect(computeSlaLevel(targetDate, dueDate, now, config)).toBe('DUE_CRITICAL')
  })

  it('retorna TARGET_WARNING dentro da janela de meta', () => {
    const targetDate = new Date('2026-10-20T00:00:00Z')
    const now = new Date('2026-10-18T00:00:00Z')
    expect(computeSlaLevel(targetDate, null, now, config)).toBe('TARGET_WARNING')
  })
})
```

- [ ] **Step 4: Rodar**

```bash
pnpm --filter web exec vitest run src/lib/sla.test.ts
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sla.ts apps/web/src/lib/sla.test.ts apps/web/src/types/index.ts
git commit -m "feat(sla): espelha computeSlaLevel no frontend + Board.type"
```

---

## Task 11: Frontend — badge de SLA no `TaskCard` + `SlaConfigContext`

**Files:**
- Create: `apps/web/src/hooks/useSlaConfig.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/components/TaskCard.tsx`
- Modify: `apps/web/src/components/TaskCard.test.tsx`

**Interfaces:**
- Consumes: `GET /sla/config` (Task 5), `computeSlaLevel` (Task 10).
- Produces: `SlaConfigProvider`, `useSlaConfig()` hook; `TaskCard` aceita badge de nível SLA sem
  quebrar a prop `isOverdue` existente (substituída pelo cálculo novo).

- [ ] **Step 1: `useSlaConfig.tsx`**

```tsx
// apps/web/src/hooks/useSlaConfig.tsx
import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface SlaConfigValue {
  slaTargetWarningDays: number
  slaDueCriticalDays: number
}

const DEFAULT_SLA_CONFIG: SlaConfigValue = { slaTargetWarningDays: 3, slaDueCriticalDays: 1 }

const SlaConfigContext = createContext<SlaConfigValue>(DEFAULT_SLA_CONFIG)

export function SlaConfigProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<SlaConfigValue>({
    queryKey: ['sla-config'],
    queryFn: () => api.get('/sla/config').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  return (
    <SlaConfigContext.Provider value={data ?? DEFAULT_SLA_CONFIG}>
      {children}
    </SlaConfigContext.Provider>
  )
}

export function useSlaConfig(): SlaConfigValue {
  return useContext(SlaConfigContext)
}
```

- [ ] **Step 2: Montar o provider em `AppLayout.tsx`**

Envolver o `return (...)` existente com `<SlaConfigProvider>`:

```tsx
import { SlaConfigProvider } from '@/hooks/useSlaConfig'
// ...
  return (
    <SlaConfigProvider>
      <div className="flex h-screen bg-background">
        {/* ...conteúdo existente sem alteração... */}
      </div>
    </SlaConfigProvider>
  )
```

- [ ] **Step 3: `TaskCard.tsx` — badge de SLA**

Substituir o cálculo de `isOverdue` pelo nível de SLA (mantendo o visual de "vencido" como caso do
nível `DUE_CRITICAL` já passado da data, e adicionando o nível `TARGET_WARNING`):

```tsx
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'
import { computeSlaLevel } from '@/lib/sla'
import { useSlaConfig } from '@/hooks/useSlaConfig'

// ...PRIORITY_STYLES, PRIORITY_LABELS, daysOpen sem alteração...

export function TaskCard({ task, onClick }: Props) {
  const slaConfig = useSlaConfig()
  const slaLevel = computeSlaLevel(
    task.targetDate ? new Date(task.targetDate) : null,
    task.dueDate ? new Date(task.dueDate) : null,
    new Date(),
    slaConfig,
  )
  const isAlertActive = task.status !== 'DONE' && task.status !== 'DISREGARDED' && slaLevel !== 'NONE'
  const effectiveLevel = isAlertActive ? slaLevel : 'NONE'

  return (
    <div
      className={cn(
        'bg-surface rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow select-none',
        effectiveLevel === 'DUE_CRITICAL' ? 'border-red-400' : effectiveLevel === 'TARGET_WARNING' ? 'border-yellow-400' : 'border-border',
      )}
      onClick={onClick}
    >
      <p className="text-sm font-medium text-foreground mb-2 line-clamp-2">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.sourceRequestId && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-600" title="Originado de uma solicitação do cliente">
            <Inbox size={11} />
            Solicitação
          </span>
        )}
        <span className={cn('inline-flex text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_STYLES[task.priority])}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        {effectiveLevel === 'DUE_CRITICAL' && (
          <span className="text-xs text-red-500 font-medium">⚠ Prazo crítico</span>
        )}
        {effectiveLevel === 'TARGET_WARNING' && (
          <span className="text-xs text-yellow-600 font-medium">⏰ Meta próxima</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">{daysOpen(task.createdAt)}</p>
    </div>
  )
}
```

- [ ] **Step 4: Ajustar `TaskCard.test.tsx`**

O teste existente provavelmente monta `TaskCard` sem um `SlaConfigProvider` por cima — como
`useSlaConfig` tem um valor de contexto default (`DEFAULT_SLA_CONFIG`), o componente deve seguir
renderizando sem erro mesmo sem provider. Ler o arquivo de teste atual e, se algum teste afirmava
"⚠ Prazo vencido" (texto antigo), ajustar a asserção para "⚠ Prazo crítico"; adicionar um teste
novo cobrindo `TARGET_WARNING` ("⏰ Meta próxima").

- [ ] **Step 5: Rodar os testes**

```bash
pnpm --filter web exec vitest run src/components/TaskCard.test.tsx
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useSlaConfig.tsx apps/web/src/components/AppLayout.tsx apps/web/src/components/TaskCard.tsx apps/web/src/components/TaskCard.test.tsx
git commit -m "feat(sla): badge visual de alerta de prazo no TaskCard"
```

---

## Task 12: Frontend — `useSlaAlerts` (polling, dedup, toast, Notification, som)

**Files:**
- Create: `apps/web/src/hooks/useSlaAlerts.ts`
- Create: `apps/web/src/components/SlaPermissionBanner.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Create: `apps/web/public/sounds/chime.mp3`, `bell.mp3`, `soft-ping.mp3` (placeholders de áudio
  curtos — ver nota abaixo)

**Interfaces:**
- Consumes: `GET /tasks?boardType=OS&openOnly=true` (+ `assigneeId` quando o papel for
  `ORG_MEMBER`), `GET /sla/preferences`, `GET /sla/custom-sound-url`, `useSlaConfig` (Task 11),
  `computeSlaLevel` (Task 10).
- Produces: hook `useSlaAlerts()` montado em `AppLayout`; componente `SlaPermissionBanner`.

> **Nota sobre os arquivos de áudio:** este plano não inclui a criação dos `.mp3` reais (são
> arquivos binários). Durante a implementação, obter 3 sons curtos (~1s, royalty-free, ex. de uma
> biblioteca de sons de notificação já licenciada para uso comercial) e salvá-los em
> `apps/web/public/sounds/chime.mp3`, `bell.mp3`, `soft-ping.mp3`. Até esses arquivos existirem, o
> hook deve degradar graciosamente (ver Step 2, `playSound` com `catch` silencioso).

- [ ] **Step 1: `useSlaAlerts.ts`**

```typescript
// apps/web/src/hooks/useSlaAlerts.ts
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useSlaConfig } from '@/hooks/useSlaConfig'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'

interface SlaTask {
  id: string
  title: string
  targetDate: string | null
  dueDate: string | null
  status: string
}

interface SlaPreference {
  targetWarningSound: string
  targetWarningVolume: number
  dueCriticalSound: string
  dueCriticalVolume: number
}

const SOUND_FILES: Record<string, string> = {
  CHIME: '/sounds/chime.mp3',
  BELL: '/sounds/bell.mp3',
  SOFT_PING: '/sounds/soft-ping.mp3',
}

async function playSound(soundKey: string, volume: number, orgCustomUrl: string | null) {
  if (soundKey === 'MUTE') return
  const src = soundKey === 'ORG_CUSTOM' ? orgCustomUrl : SOUND_FILES[soundKey]
  if (!src) return
  try {
    const audio = new Audio(src)
    audio.volume = Math.min(Math.max(volume, 0), 100) / 100
    await audio.play()
  } catch {
    // Autoplay bloqueado ou arquivo ausente — não deve quebrar o alerta visual/toast.
  }
}

export function useSlaAlerts(): { permissionNeeded: boolean; requestPermission: () => void } {
  const { user } = useAuth()
  const slaConfig = useSlaConfig()
  const [permissionNeeded, setPermissionNeeded] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'default',
  )
  const seenRef = useRef<Set<string>>(new Set())

  const isOrgRole = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'].includes(user?.role ?? '')

  const { data: tasks = [] } = useQuery<SlaTask[]>({
    queryKey: ['sla-alert-tasks', user?.role],
    queryFn: () => api.get('/tasks', {
      params: {
        boardType: 'OS',
        openOnly: true,
        ...(user?.role === 'ORG_MEMBER' ? { assigneeId: user.id } : {}),
      },
    }).then((r) => r.data.items ?? r.data),
    enabled: isOrgRole,
    refetchInterval: 60_000,
  })

  const { data: preference } = useQuery<SlaPreference>({
    queryKey: ['sla-preference'],
    queryFn: () => api.get('/sla/preferences').then((r) => r.data),
    enabled: isOrgRole,
    staleTime: 5 * 60 * 1000,
  })

  const { data: customSound } = useQuery<{ url: string | null }>({
    queryKey: ['sla-custom-sound-url'],
    queryFn: () => api.get('/sla/custom-sound-url').then((r) => r.data),
    enabled: isOrgRole,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!isOrgRole || !preference) return

    for (const task of tasks) {
      const level = computeSlaLevel(
        task.targetDate ? new Date(task.targetDate) : null,
        task.dueDate ? new Date(task.dueDate) : null,
        new Date(),
        slaConfig,
      )
      if (level === 'NONE') continue

      const key = `sla:${task.id}:${level}`
      if (sessionStorage.getItem(key)) continue
      sessionStorage.setItem(key, '1')

      const isCritical = level === 'DUE_CRITICAL'
      const label = isCritical ? 'Prazo crítico' : 'Meta se aproximando'
      toast(label, { description: task.title })

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(label, { body: task.title })
      }

      const soundKey = isCritical ? preference.dueCriticalSound : preference.targetWarningSound
      const volume = isCritical ? preference.dueCriticalVolume : preference.targetWarningVolume
      void playSound(soundKey, volume, customSound?.url ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, preference, customSound, isOrgRole])

  function requestPermission() {
    if (typeof Notification === 'undefined') return
    Notification.requestPermission().then(() => setPermissionNeeded(false))
  }

  return { permissionNeeded, requestPermission }
}
```

- [ ] **Step 2: `SlaPermissionBanner.tsx`**

```tsx
// apps/web/src/components/SlaPermissionBanner.tsx
import { useState } from 'react'
import { Bell, X } from 'lucide-react'

interface Props {
  onAccept: () => void
}

export function SlaPermissionBanner({ onAccept }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-center justify-between gap-3 bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm text-blue-900">
      <div className="flex items-center gap-2">
        <Bell size={16} />
        <span>Ative notificações do navegador para receber alertas de prazo em tempo real.</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onAccept} className="font-medium underline">Ativar</button>
        <button aria-label="Fechar" onClick={() => setDismissed(true)} className="text-blue-700">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Montar em `AppLayout.tsx`**

```tsx
import { useSlaAlerts } from '@/hooks/useSlaAlerts'
import { SlaPermissionBanner } from '@/components/SlaPermissionBanner'
// ...
  const { permissionNeeded, requestPermission } = useSlaAlerts()
// ...no JSX, dentro do SlaConfigProvider, acima da <main>:
      {permissionNeeded && <SlaPermissionBanner onAccept={requestPermission} />}
```

- [ ] **Step 4: Verificar**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 5: QA visual manual (Playwright, seguindo o padrão já usado neste projeto para
  mudanças de UI)**

Logar como `admin@g2a.com.br`, abrir o app, confirmar que o banner de permissão aparece (se
`Notification.permission` for `default` no navegador de teste), e que uma task OS com
`dueDate`/`targetDate` dentro da janela de alerta mostra o badge correto no Kanban.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useSlaAlerts.ts apps/web/src/components/SlaPermissionBanner.tsx apps/web/src/components/AppLayout.tsx apps/web/public/sounds
git commit -m "feat(sla): push em tempo real (toast + Notification + som) para tasks OS"
```

---

## Task 13: Frontend — preferência de som do usuário (`Profile.tsx`)

**Files:**
- Modify: `apps/web/src/pages/app/settings/Profile.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /sla/preferences`, `GET /sla/custom-sound-url` (Task 5).

- [ ] **Step 1: Adicionar seção de preferência de som**

No mesmo arquivo, seguindo o padrão de `useQuery`/`useMutation` já usado para o perfil e troca de
senha, adicionar uma nova seção "Alertas de prazo" com:
- Dois seletores (`<select>`) — "Som ao aproximar da meta" e "Som ao ficar crítico" — com opções
  `CHIME`, `BELL`, `SOFT_PING`, `MUTE` e, condicionalmente, `ORG_CUSTOM` (só aparece se `GET
  /sla/custom-sound-url` retornar uma `url` não-nula).
- Dois sliders de volume (`<input type="range" min={0} max={100}>`) pareados com cada seletor.
- Um botão "Testar" por nível, que reutiliza a mesma lógica de `playSound` (extrair o helper de
  `useSlaAlerts.ts` para `apps/web/src/lib/sla-sound.ts` se for reaproveitado aqui, em vez de
  duplicar a função).

```tsx
// Dentro do componente Profile, antes do return final:
const { data: slaPreference } = useQuery<{
  targetWarningSound: string; targetWarningVolume: number
  dueCriticalSound: string; dueCriticalVolume: number
}>({
  queryKey: ['sla-preference'],
  queryFn: () => api.get('/sla/preferences').then((r) => r.data),
})

const { data: customSound } = useQuery<{ url: string | null }>({
  queryKey: ['sla-custom-sound-url'],
  queryFn: () => api.get('/sla/custom-sound-url').then((r) => r.data),
})

const slaPrefMutation = useMutation({
  mutationFn: (data: Partial<typeof slaPreference>) => api.patch('/sla/preferences', data).then((r) => r.data),
  onSuccess: () => {
    toast.success('Preferência de som atualizada')
    queryClient.invalidateQueries({ queryKey: ['sla-preference'] })
  },
})
```

E o bloco de UI (seguindo o mesmo padrão visual das outras seções do arquivo — `bg-surface
rounded-xl border border-border`), com os dois pares seletor+slider+botão "Testar" descritos acima,
disparando `slaPrefMutation.mutate({ targetWarningSound: ... })` no `onChange` dos selects e no
`onMouseUp`/`onChange` dos sliders (evitar mutação a cada pixel do drag — usar `onChange` do range
nativo, que já dispara só na soltura em touch mas a cada tick no mouse; aceitável para este caso,
sem debounce adicional por enquanto).

- [ ] **Step 2: Extrair helper de som compartilhado**

Criar `apps/web/src/lib/sla-sound.ts` com a função `playSound` (movida de `useSlaAlerts.ts`), e
importar dos dois lugares (`useSlaAlerts.ts` e `Profile.tsx`) em vez de duplicar o código.

- [ ] **Step 3: Verificar e QA manual**

```bash
pnpm --filter web exec tsc --noEmit
```

Testar manualmente: trocar o som, recarregar a página, confirmar que a preferência persistiu
(round-trip real contra o backend).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/Profile.tsx apps/web/src/lib/sla-sound.ts apps/web/src/hooks/useSlaAlerts.ts
git commit -m "feat(sla): tela de preferência de som de alerta de prazo no perfil"
```

---

## Task 14: Frontend — upload de som customizado + toggles de SLA em Configurações

**Files:**
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`

**Interfaces:**
- Consumes: `PATCH /notifications/config` (thresholds + `slaDigestEnabled`), `POST/DELETE
  /notifications/config/sla-sound` (Task 4).

- [ ] **Step 1: `Notifications.tsx` — remover o toggle antigo, adicionar os novos**

Remover a linha/row de `dueDateAlert` (evento "Prazo se aproximando" antigo) de dentro da seção
"Eventos — Tarefas", e adicionar:
- Uma nova seção "Alertas de SLA" com: dois inputs numéricos (`slaTargetWarningDays`,
  `slaDueCriticalDays`, min 0 max 90), um `SwitchRow` para `slaDigestEnabled` ("Resumo diário de
  prazos"), e um bloco de upload de som (input `type="file"` accept `audio/mpeg,audio/wav` +
  label de texto + botão "Enviar" fazendo `POST /notifications/config/sla-sound` via
  `FormData`/multipart, e um botão "Remover" quando `customSlaSoundLabel` já existir, chamando
  `DELETE /notifications/config/sla-sound`).
- Remover `dueDateAlert` do `EVENT_LABEL` do histórico, se existir, mantendo os demais.

- [ ] **Step 2: `Templates.tsx` — atualizar `EVENTS`**

Remover `TASK_DUE_DATE_APPROACHING` e adicionar `SLA_DIGEST` no array `EVENTS` e no `EVENT_LABEL`
("Resumo diário de prazos").

- [ ] **Step 3: Verificar e QA manual via Playwright**

```bash
pnpm --filter web exec tsc --noEmit
```

Logar como admin, ir em Configurações → confirmar os campos novos renderizam e persistem; subir um
`.mp3` de teste e confirmar que aparece a label e o botão "Remover"; ir em Templates → confirmar
que "Resumo diário de prazos" aparece no seletor e o editor abre sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/Notifications.tsx apps/web/src/pages/app/settings/Templates.tsx
git commit -m "feat(sla): configuração de thresholds, digest e som customizado em Configurações"
```

---

## Task 15: Limpeza final e verificação de ponta a ponta

**Files:**
- Review: toda a árvore tocada nas Tasks 1-14.

- [ ] **Step 1: Busca por referências residuais ao mecanismo antigo**

```bash
grep -rn "TASK_DUE_DATE_APPROACHING\|dueDateAlert\|duedate.cron" apps/api/src apps/web/src
```

Esperado: nenhuma ocorrência. Se algo aparecer (ex: um teste esquecido, uma referência em
`EVENT_LABEL`), corrigir antes de seguir.

- [ ] **Step 2: Suites completas**

```bash
pnpm --filter api test
pnpm --filter web test
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: QA manual de ponta a ponta (Playwright)**

Fluxo completo: criar/editar uma task em board OS com `dueDate` dentro da janela crítica → ver
badge vermelho no Kanban → ver toast+Notification (se permissão concedida) → confirmar log em
`NotificationLog` não é gerado por esse fluxo em tempo real (só o digest gera log) → forçar
`runSlaDigest` manualmente (script Node com `DATABASE_URL` carregado, mesmo padrão já usado nesta
sessão) e confirmar que o `NotificationLog` do evento `SLA_DIGEST` aparece.

- [ ] **Step 4: Atualizar `docs/TASKS.md`**

Marcar o item 3 do roadmap ("SLA e alertas de prazo") como concluído, com uma linha curta
resumindo o que foi entregue (badge visual, push+som customizável só OS, digest diário
substituindo o cron antigo).

- [ ] **Step 5: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca SLA e alertas de prazo como concluído no roadmap"
```
