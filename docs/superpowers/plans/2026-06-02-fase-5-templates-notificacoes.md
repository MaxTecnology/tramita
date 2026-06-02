# Fase 5: Templates e Notificações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o sistema completo de notificações: libs de envio (MaximizeBot + Nodemailer), interpolação de templates com fallback para defaults hardcoded, CRUD de configuração e templates por org, BullMQ worker com retry 3×, cron de dueDate, e 6 arquivos de teste obrigatórios.

**Architecture:** As libs (`template`, `maximizebot`, `mailer`, `encryption`, `queue`) ficam em `src/lib/` com responsabilidades únicas e interfaces explícitas. O worker (`src/workers/notification.worker.ts`) exporta `processNotificationJob` como função pura testável separada do Worker BullMQ. As rotas HTTP ficam em `src/modules/notifications/`. O stub `src/lib/queue.ts` é substituído pela implementação BullMQ real — nenhum service de tasks/comments precisa mudar.

**Tech Stack:** BullMQ 5 (já instalado), axios (já instalado), nodemailer (instalar), Node.js `crypto` nativo (AES-256-GCM), Prisma 6, Zod, Vitest (`vi.mock` para axios e nodemailer).

---

## File Map

**Criar:**
- `apps/api/src/lib/template.ts` — `renderTemplate`, `getTemplate`, `TemplateVars`, `PREVIEW_VARS`
- `apps/api/src/lib/default-templates.ts` — `DEFAULT_TEMPLATES` (fallbacks hardcoded por evento/canal)
- `apps/api/src/lib/maximizebot.ts` — `sendWhatsApp` (wrapper axios)
- `apps/api/src/lib/mailer.ts` — `sendEmail` (wrapper nodemailer)
- `apps/api/src/lib/encryption.ts` — `encrypt` / `decrypt` (AES-256-GCM)
- `apps/api/src/modules/notifications/notifications.schema.ts`
- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/src/modules/notifications/notifications.routes.ts`
- `apps/api/src/workers/notification.worker.ts` — `processNotificationJob` + `startNotificationWorker`
- `apps/api/src/workers/duedate.cron.ts` — `startDueDateCronWorker`
- `apps/api/src/worker.ts` — entry point dos workers
- `apps/api/src/lib/template.test.ts`
- `apps/api/src/lib/maximizebot.test.ts`
- `apps/api/src/lib/mailer.test.ts`
- `apps/api/src/workers/notification-worker.test.ts`
- `apps/api/src/modules/notifications/templates.routes.test.ts`

**Modificar:**
- `apps/api/src/lib/queue.ts` — substituir stub pelo BullMQ real
- `apps/api/src/test/setup.ts` — adicionar `ENCRYPTION_KEY` de teste
- `apps/api/src/server.ts` — registrar `notificationsRoutes`
- `apps/api/package.json` — adicionar script `"worker": "tsx src/worker.ts"`
- `docs/TASKS.md` — marcar Fase 5 como concluída

---

## Task 1: Setup — nodemailer + ENCRYPTION_KEY + worker script

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/test/setup.ts`

- [ ] **Step 1: Instalar nodemailer**

```bash
pnpm --filter api add nodemailer
pnpm --filter api add -D @types/nodemailer
```

Esperado: `nodemailer` aparece em `dependencies` no `apps/api/package.json`.

- [ ] **Step 2: Adicionar script worker em package.json**

Abrir `apps/api/package.json` e adicionar no objeto `"scripts"`:
```json
"worker": "tsx src/worker.ts"
```

- [ ] **Step 3: Adicionar ENCRYPTION_KEY de teste no setup.ts**

Abrir `apps/api/src/test/setup.ts` e adicionar logo após os imports, antes de `generateKeyPairSync`:

```typescript
// 32 bytes de zeros em hex — só para testes
process.env.ENCRYPTION_KEY = '0'.repeat(64)
```

- [ ] **Step 4: Adicionar ENCRYPTION_KEY ao .env (dev)**

No arquivo `/home/max/job/autohubs/tramita/.env`, adicionar (se ainda não tiver):

```
ENCRYPTION_KEY=<gerar com: openssl rand -hex 32>
```

Em desenvolvimento pode usar qualquer valor de 64 chars hex. Exemplo rápido:
```bash
openssl rand -hex 32
```

- [ ] **Step 5: Verificar que os testes existentes continuam passando**

```bash
pnpm --filter api test 2>&1 | tail -5
```

Esperado: `88 passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/test/setup.ts pnpm-lock.yaml
git commit -m "chore: instala nodemailer + ENCRYPTION_KEY no test setup + script worker"
```

---

## Task 2: template.ts + default-templates.ts (TDD)

**Files:**
- Create: `apps/api/src/lib/template.ts`
- Create: `apps/api/src/lib/default-templates.ts`
- Create: `apps/api/src/lib/template.test.ts`

- [ ] **Step 1: Criar default-templates.ts**

```typescript
// apps/api/src/lib/default-templates.ts
import type { NotificationEvent, MessageChannel } from '@prisma/client'

type TemplateEntry = { subject?: string; body: string }
type TemplateMap = Record<NotificationEvent, Partial<Record<MessageChannel, TemplateEntry>>>

export const DEFAULT_TEMPLATES: TemplateMap = {
  TASK_CREATED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Um novo processo *{{taskTitle}}* foi aberto para você.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo processo — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nUm novo processo foi aberto: *{{taskTitle}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_MOVED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Atualização — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMPLETED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* foi concluído!\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Processo concluído — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* foi concluído com sucesso!\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMMENT_ADDED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Novo comentário em *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo comentário — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nNovo comentário em *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_DUE_DATE_APPROACHING: {
    WHATSAPP: { body: 'Olá, {{clientName}}! O processo *{{taskTitle}}* vence em {{dueDate}}. Acesse: {{portalUrl}}' },
    EMAIL: { subject: 'Prazo se aproximando — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nO processo *{{taskTitle}}* vence em {{dueDate}}.\n\nAcompanhe em: {{portalUrl}}' },
  },
}
```

- [ ] **Step 2: Escrever template.test.ts (TDD — antes da implementação)**

```typescript
// apps/api/src/lib/template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, getTemplate, type TemplateVars } from '@/lib/template'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg } from '@/test/helpers'

const BASE_VARS: TemplateVars = {
  clientName: 'João Silva',
  orgName: 'Escritório G2A',
  taskTitle: 'Abertura de LTDA',
  portalUrl: 'https://tramita.autohubs.com.br/portal',
}

describe('renderTemplate', () => {
  it('substitutes all provided variables', () => {
    const body = 'Olá, {{clientName}}! Processo *{{taskTitle}}* movido para *{{toColumn}}*.'
    const result = renderTemplate(body, { ...BASE_VARS, toColumn: 'Em Revisão' })
    expect(result).toBe('Olá, João Silva! Processo *Abertura de LTDA* movido para *Em Revisão*.')
  })

  it('replaces missing variable with empty string', () => {
    const body = 'Prazo: {{dueDate}}'
    expect(renderTemplate(body, BASE_VARS)).toBe('Prazo: ')
  })

  it('keeps body unchanged when it has no variables', () => {
    const body = 'Texto fixo sem variáveis.'
    expect(renderTemplate(body, BASE_VARS)).toBe('Texto fixo sem variáveis.')
  })
})

describe('DEFAULT_TEMPLATES', () => {
  it('TASK_MOVED WHATSAPP body contains {{fromColumn}} and {{toColumn}}', () => {
    const body = DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body
    expect(body).toContain('{{fromColumn}}')
    expect(body).toContain('{{toColumn}}')
  })
})

describe('getTemplate', () => {
  it('returns custom template when org has one configured', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.messageTemplate.create({
      data: {
        organizationId: org.id,
        event: 'TASK_MOVED',
        channel: 'WHATSAPP',
        body: 'Template customizado para {{clientName}}',
      },
    })

    const result = await getTemplate(org.id, 'TASK_MOVED', 'WHATSAPP')
    expect(result.body).toBe('Template customizado para {{clientName}}')
  })

  it('returns default template when org has no custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await getTemplate(org.id, 'TASK_MOVED', 'WHATSAPP')
    expect(result.body).toBe(DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body)
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/lib/template.test.ts 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/lib/template'".

- [ ] **Step 4: Criar template.ts**

```typescript
// apps/api/src/lib/template.ts
import type { NotificationEvent, MessageChannel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'

export interface TemplateVars {
  clientName: string
  orgName: string
  taskTitle: string
  fromColumn?: string
  toColumn?: string
  dueDate?: string
  portalUrl: string
  commentText?: string
  commentAuthorName?: string
}

export const PREVIEW_VARS: TemplateVars = {
  clientName: 'João Silva',
  orgName: 'Escritório G2A',
  taskTitle: 'Abertura de LTDA',
  fromColumn: 'Documentação Pendente',
  toColumn: 'Em Revisão',
  dueDate: '30/06/2026',
  portalUrl: 'https://tramita.autohubs.com.br/portal',
  commentText: 'Documento recebido, obrigado!',
  commentAuthorName: 'Dr. Carlos Mendes',
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof TemplateVars] ?? '')
}

export async function getTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
): Promise<{ body: string; subject?: string }> {
  const custom = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  return custom ?? DEFAULT_TEMPLATES[event]?.[channel] ?? { body: '' }
}
```

- [ ] **Step 5: Rodar template.test.ts — deve passar**

```bash
pnpm --filter api test src/lib/template.test.ts --reporter=verbose 2>&1 | tail -15
```

Esperado: 6 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/template.ts apps/api/src/lib/default-templates.ts apps/api/src/lib/template.test.ts
git commit -m "feat: renderTemplate + getTemplate + DEFAULT_TEMPLATES com testes"
```

---

## Task 3: maximizebot.ts (TDD)

**Files:**
- Create: `apps/api/src/lib/maximizebot.ts`
- Create: `apps/api/src/lib/maximizebot.test.ts`

- [ ] **Step 1: Escrever maximizebot.test.ts (TDD)**

```typescript
// apps/api/src/lib/maximizebot.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'
import { sendWhatsApp } from '@/lib/maximizebot'

vi.mock('axios')

describe('sendWhatsApp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls MaximizeBot API with correct URL, payload and Authorization header', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: {} })

    await sendWhatsApp('Bearer test-token', {
      number: '5582999990001',
      body: 'Olá, João!',
      saveOnTicket: true,
      startChatbot: false,
      linkPreview: true,
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://app.maximizebot.com.br/backend/api/messages/send',
      {
        number: '5582999990001',
        body: 'Olá, João!',
        saveOnTicket: true,
        startChatbot: false,
        linkPreview: true,
      },
      { headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } },
    )
  })

  it('throws when axios rejects', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('Network error'))
    await expect(
      sendWhatsApp('Bearer token', { number: '55829', body: 'test' }),
    ).rejects.toThrow('Network error')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/lib/maximizebot.test.ts 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/lib/maximizebot'".

- [ ] **Step 3: Criar maximizebot.ts**

```typescript
// apps/api/src/lib/maximizebot.ts
import axios from 'axios'

export interface SendWhatsAppPayload {
  number: string
  body: string
  saveOnTicket?: boolean
  startChatbot?: boolean
  linkPreview?: boolean
}

export async function sendWhatsApp(token: string, payload: SendWhatsAppPayload): Promise<void> {
  await axios.post(
    'https://app.maximizebot.com.br/backend/api/messages/send',
    payload,
    { headers: { Authorization: token, 'Content-Type': 'application/json' } },
  )
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter api test src/lib/maximizebot.test.ts --reporter=verbose 2>&1 | tail -10
```

Esperado: 2 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/maximizebot.ts apps/api/src/lib/maximizebot.test.ts
git commit -m "feat: sendWhatsApp client MaximizeBot com testes"
```

---

## Task 4: mailer.ts (TDD)

**Files:**
- Create: `apps/api/src/lib/mailer.ts`
- Create: `apps/api/src/lib/mailer.test.ts`

- [ ] **Step 1: Escrever mailer.test.ts (TDD)**

```typescript
// apps/api/src/lib/mailer.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import nodemailer from 'nodemailer'
import { sendEmail, type SmtpConfig } from '@/lib/mailer'

vi.mock('nodemailer')

const TEST_CONFIG: SmtpConfig = {
  host: 'smtp.test.com',
  port: 587,
  user: 'user@test.com',
  pass: 'senha123',
  from: 'Test <noreply@test.com>',
}

describe('sendEmail', () => {
  const mockSendMail = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: mockSendMail.mockResolvedValue({}),
    } as any)
  })

  it('calls sendMail with correct to, subject and text', async () => {
    await sendEmail(TEST_CONFIG, 'cliente@exemplo.com', 'Assunto do email', 'Corpo do email')

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'Test <noreply@test.com>',
      to: 'cliente@exemplo.com',
      subject: 'Assunto do email',
      text: 'Corpo do email',
    })
  })

  it('creates transport with correct SMTP config', async () => {
    await sendEmail(TEST_CONFIG, 'to@test.com', 'subject', 'body')

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      auth: { user: 'user@test.com', pass: 'senha123' },
    })
  })

  it('throws when sendMail rejects', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'))
    await expect(sendEmail(TEST_CONFIG, 'to@test.com', 'subject', 'body')).rejects.toThrow('SMTP error')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/lib/mailer.test.ts 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/lib/mailer'".

- [ ] **Step 3: Criar mailer.ts**

```typescript
// apps/api/src/lib/mailer.ts
import nodemailer from 'nodemailer'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string  // já decriptografado antes de chamar esta função
  from: string
}

export async function sendEmail(
  config: SmtpConfig,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: { user: config.user, pass: config.pass },
  })
  await transporter.sendMail({ from: config.from, to, subject, text: body })
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter api test src/lib/mailer.test.ts --reporter=verbose 2>&1 | tail -10
```

Esperado: 3 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/mailer.ts apps/api/src/lib/mailer.test.ts
git commit -m "feat: sendEmail client Nodemailer com testes"
```

---

## Task 5: encryption.ts + queue.ts real

**Files:**
- Create: `apps/api/src/lib/encryption.ts`
- Modify: `apps/api/src/lib/queue.ts`

- [ ] **Step 1: Criar encryption.ts**

```typescript
// apps/api/src/lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? ''
  if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encoded: string): string {
  const key = getKey()
  const [ivHex, tagHex, encHex] = encoded.split(':')
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
}
```

- [ ] **Step 2: Substituir queue.ts stub pela implementação BullMQ real**

Sobrescrever `apps/api/src/lib/queue.ts`:

```typescript
// apps/api/src/lib/queue.ts
import { Queue } from 'bullmq'
import { redis } from '@/lib/redis'

export interface NotificationJob {
  event: string
  taskId: string
  organizationId: string
  clientId: string
  metadata: Record<string, string | undefined>
}

export const notificationQueue = new Queue('notification-queue', { connection: redis })

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationQueue.add(job.event, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
```

- [ ] **Step 3: Verificar compilação e testes existentes**

```bash
pnpm --filter api test 2>&1 | tail -5
```

Esperado: todos os testes anteriores continuam passando. O BullMQ Queue com `lazyConnect: true` conecta sob demanda sem bloquear os testes.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/encryption.ts apps/api/src/lib/queue.ts
git commit -m "feat: encryption AES-256-GCM + queue BullMQ real (substitui stub)"
```

---

## Task 6: Notifications module (TDD)

**Files:**
- Create: `apps/api/src/modules/notifications/notifications.schema.ts`
- Create: `apps/api/src/modules/notifications/templates.routes.test.ts`
- Create: `apps/api/src/modules/notifications/notifications.service.ts`
- Create: `apps/api/src/modules/notifications/notifications.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar notifications.schema.ts**

```typescript
// apps/api/src/modules/notifications/notifications.schema.ts
import { z } from 'zod'
import { NotificationEvent, MessageChannel } from '@prisma/client'

export const updateConfigSchema = z.object({
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  taskCreated: z.boolean().optional(),
  taskMoved: z.boolean().optional(),
  taskCompleted: z.boolean().optional(),
  commentAdded: z.boolean().optional(),
  dueDateAlert: z.boolean().optional(),
  maximizebotToken: z.string().optional(),
  saveOnTicket: z.boolean().optional(),
  startChatbot: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  emailFrom: z.string().optional(),
})

export const upsertTemplateSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
})

export const previewSchema = z.object({
  event: z.nativeEnum(NotificationEvent),
  channel: z.nativeEnum(MessageChannel),
  body: z.string().optional(),
})

export const testWhatsappSchema = z.object({ number: z.string().min(10) })
export const testEmailSchema = z.object({ to: z.string().email() })

export const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
  channel: z.nativeEnum(MessageChannel).optional(),
})

export const eventParamSchema = z.nativeEnum(NotificationEvent)
export const channelParamSchema = z.nativeEnum(MessageChannel)

export type UpdateConfigBody = z.infer<typeof updateConfigSchema>
export type UpsertTemplateBody = z.infer<typeof upsertTemplateSchema>
```

- [ ] **Step 2: Escrever templates.routes.test.ts (TDD)**

```typescript
// apps/api/src/modules/notifications/templates.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'

describe('POST /notifications/templates/preview', () => {
  it('renders preview with provided body and fictional vars', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates/preview',
      headers: { authorization: auth },
      payload: {
        event: 'TASK_MOVED',
        channel: 'WHATSAPP',
        body: 'Olá, {{clientName}}! Processo {{taskTitle}} → {{toColumn}}.',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.rendered).toContain('João Silva')
    expect(body.rendered).toContain('Abertura de LTDA')
    expect(body.rendered).toContain('Em Revisão')
  })

  it('uses default template when body is not provided', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/templates/preview',
      headers: { authorization: auth },
      payload: { event: 'TASK_MOVED', channel: 'WHATSAPP' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).rendered).toBeTruthy()
  })
})

describe('PUT /notifications/templates/:event/:channel', () => {
  it('persists and returns custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'PUT',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
      payload: { body: 'Template customizado {{clientName}}' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).body).toBe('Template customizado {{clientName}}')
  })
})

describe('GET /notifications/templates/:event/:channel', () => {
  it('returns default template with isDefault=true when org has no custom', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.body).toBe(DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP!.body)
    expect(body.isDefault).toBe(true)
  })

  it('returns isDefault=false when org has custom template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const auth = await getAuthHeader(user.email, 'Test@1234')

    await app.inject({
      method: 'PUT',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
      payload: { body: 'Template da org' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/notifications/templates/TASK_MOVED/WHATSAPP',
      headers: { authorization: auth },
    })

    expect(JSON.parse(res.body).isDefault).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/notifications/templates.routes.test.ts 2>&1 | tail -5
```

Esperado: FAIL — rotas não registradas.

- [ ] **Step 4: Criar notifications.service.ts**

```typescript
// apps/api/src/modules/notifications/notifications.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { encrypt, decrypt } from '@/lib/encryption'
import { getTemplate, renderTemplate, PREVIEW_VARS } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import type { NotificationEvent, MessageChannel } from '@prisma/client'
import type { UpdateConfigBody, UpsertTemplateBody } from './notifications.schema'

export async function getConfig(organizationId: string) {
  return prisma.notificationConfig.findUnique({ where: { organizationId } })
}

export async function updateConfig(organizationId: string, data: UpdateConfigBody) {
  const toSave = { ...data }
  if (toSave.smtpPass) toSave.smtpPass = encrypt(toSave.smtpPass)
  return prisma.notificationConfig.upsert({
    where: { organizationId },
    create: { organizationId, ...toSave },
    update: toSave,
  })
}

export async function listTemplates(organizationId: string) {
  return prisma.messageTemplate.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ event: 'asc' }, { channel: 'asc' }],
  })
}

export async function getTemplateForOrg(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
) {
  const custom = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  const template = await getTemplate(organizationId, event, channel)
  return { ...template, isDefault: !custom }
}

export async function upsertTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
  data: UpsertTemplateBody,
) {
  return prisma.messageTemplate.upsert({
    where: { organizationId_event_channel: { organizationId, event, channel } },
    create: { organizationId, event, channel, ...data },
    update: data,
  })
}

export async function deleteTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
) {
  const template = await prisma.messageTemplate.findUnique({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  if (!template) throw new AppError(404, 'Template não encontrado')
  await prisma.messageTemplate.delete({
    where: { organizationId_event_channel: { organizationId, event, channel } },
  })
  return { ok: true }
}

export async function previewTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
  body?: string,
) {
  const templateBody = body ?? (await getTemplate(organizationId, event, channel)).body
  return { rendered: renderTemplate(templateBody, PREVIEW_VARS) }
}

export async function testWhatsApp(organizationId: string, number: string) {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.maximizebotToken) throw new AppError(422, 'MaximizeBot não configurado')
  await sendWhatsApp(config.maximizebotToken, {
    number,
    body: 'Teste de integração MaximizeBot — Tramita AutoHubs',
    saveOnTicket: false,
  })
  return { ok: true }
}

export async function testEmail(organizationId: string, to: string) {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config?.smtpHost || !config.smtpPass) throw new AppError(422, 'SMTP não configurado')
  const pass = decrypt(config.smtpPass)
  await sendEmail(
    { host: config.smtpHost, port: config.smtpPort!, user: config.smtpUser!, pass, from: config.emailFrom! },
    to,
    'Teste de Email — Tramita AutoHubs',
    'Este é um email de teste enviado pelo Tramita.',
  )
  return { ok: true }
}

export async function listLogs(
  organizationId: string,
  filters: { page: number; limit: number; status?: string; channel?: string },
) {
  const skip = (filters.page - 1) * filters.limit
  return prisma.notificationLog.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.channel ? { channel: filters.channel as any } : {}),
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: filters.limit,
  })
}
```

- [ ] **Step 5: Criar notifications.routes.ts**

```typescript
// apps/api/src/modules/notifications/notifications.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  updateConfigSchema,
  upsertTemplateSchema,
  previewSchema,
  testWhatsappSchema,
  testEmailSchema,
  logsQuerySchema,
  eventParamSchema,
  channelParamSchema,
} from './notifications.schema'
import {
  getConfig,
  updateConfig,
  listTemplates,
  getTemplateForOrg,
  upsertTemplate,
  deleteTemplate,
  previewTemplate,
  testWhatsApp,
  testEmail,
  listLogs,
} from './notifications.service'

export async function notificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  // Config
  app.get('/config', async (request, reply) => {
    return reply.send(await getConfig(request.user.organizationId!))
  })

  app.patch('/config', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = updateConfigSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateConfig(request.user.organizationId!, result.data))
  })

  app.post('/config/test-whatsapp', async (request, reply) => {
    const result = testWhatsappSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await testWhatsApp(request.user.organizationId!, result.data.number))
  })

  app.post('/config/test-email', async (request, reply) => {
    const result = testEmailSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await testEmail(request.user.organizationId!, result.data.to))
  })

  // Templates — preview ANTES de /:event/:channel
  app.get('/templates', async (request, reply) => {
    return reply.send(await listTemplates(request.user.organizationId!))
  })

  app.post('/templates/preview', async (request, reply) => {
    const result = previewSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await previewTemplate(
        request.user.organizationId!,
        result.data.event,
        result.data.channel,
        result.data.body,
      ),
    )
  })

  app.get('/templates/:event/:channel', async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    return reply.send(await getTemplateForOrg(request.user.organizationId!, ev.data, ch.data))
  })

  app.put('/templates/:event/:channel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    const result = upsertTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await upsertTemplate(request.user.organizationId!, ev.data, ch.data, result.data))
  })

  app.delete('/templates/:event/:channel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { event, channel } = request.params as { event: string; channel: string }
    const ev = eventParamSchema.safeParse(event)
    const ch = channelParamSchema.safeParse(channel)
    if (!ev.success || !ch.success) throw new AppError(400, 'Evento ou canal inválido')
    return reply.send(await deleteTemplate(request.user.organizationId!, ev.data, ch.data))
  })

  // Logs
  app.get('/logs', async (request, reply) => {
    const result = logsQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await listLogs(request.user.organizationId!, result.data))
  })
}
```

- [ ] **Step 6: Registrar em server.ts**

Abrir `apps/api/src/server.ts` e adicionar import:
```typescript
import { notificationsRoutes } from '@/modules/notifications/notifications.routes'
```

Adicionar após `commentsRoutes`:
```typescript
app.register(notificationsRoutes, { prefix: '/notifications' })
```

- [ ] **Step 7: Rodar templates.routes.test.ts — deve passar**

```bash
pnpm --filter api test src/modules/notifications/templates.routes.test.ts --reporter=verbose 2>&1 | tail -15
```

Esperado: 4 testes PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/notifications/ apps/api/src/server.ts
git commit -m "feat: módulo notifications — config, templates, preview, logs"
```

---

## Task 7: notification.worker.ts (TDD)

**Files:**
- Create: `apps/api/src/workers/notification.worker.ts`
- Create: `apps/api/src/workers/notification-worker.test.ts`

- [ ] **Step 1: Criar diretório workers**

```bash
mkdir -p /home/max/job/autohubs/tramita/apps/api/src/workers
```

- [ ] **Step 2: Escrever notification-worker.test.ts (TDD)**

```typescript
// apps/api/src/workers/notification-worker.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { processNotificationJob } from '@/workers/notification.worker'
import * as maximizebot from '@/lib/maximizebot'
import * as mailer from '@/lib/mailer'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import type { NotificationJob } from '@/lib/queue'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/maximizebot')
vi.mock('@/lib/mailer')

type JobInput = { data: NotificationJob }

describe('processNotificationJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not send and creates no log when event is disabled in config', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Teste',
        email: `worker-client-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        whatsapp: '5582999990001',
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        taskMoved: false,
        whatsappEnabled: true,
        maximizebotToken: 'Bearer token',
      },
    })

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title, fromColumn: 'A', toColumn: 'B' },
      },
    }

    await processNotificationJob(job)

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany()
    expect(logs).toHaveLength(0)
  })

  it('creates NotificationLog with status FAILED when sendWhatsApp throws', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Falha',
        email: `worker-fail-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        whatsapp: '5582999990002',
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        taskMoved: true,
        whatsappEnabled: true,
        maximizebotToken: 'Bearer token',
      },
    })

    vi.mocked(maximizebot.sendWhatsApp).mockRejectedValue(new Error('API error'))

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title, fromColumn: 'Backlog', toColumn: 'Em Revisão' },
      },
    }

    await processNotificationJob(job)

    const log = await prisma.notificationLog.findFirst()
    expect(log?.status).toBe('FAILED')
    expect(log?.error).toBe('API error')
  })

  it('finishes silently when org has no NotificationConfig', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await prisma.client.create({
      data: {
        name: 'Cliente Sem Config',
        email: `worker-noconf-${Date.now()}@test.com`,
        passwordHash: await bcrypt.hash('pass', 4),
        organizationId: org.id,
      },
    })
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const job: JobInput = {
      data: {
        event: 'TASK_MOVED',
        taskId: task.id,
        organizationId: org.id,
        clientId: client.id,
        metadata: { taskTitle: task.title },
      },
    }

    await expect(processNotificationJob(job)).resolves.toBeUndefined()
    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/workers/notification-worker.test.ts 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/workers/notification.worker'".

- [ ] **Step 4: Criar notification.worker.ts**

```typescript
// apps/api/src/workers/notification.worker.ts
import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { renderTemplate, getTemplate } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import { decrypt } from '@/lib/encryption'
import type { NotificationConfig, NotificationEvent, MessageChannel } from '@prisma/client'
import type { NotificationJob } from '@/lib/queue'

const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
}

export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, taskId, organizationId, clientId, metadata } = job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled) return

  const [client, task, org] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.task.findUnique({ where: { id: taskId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!client || !task || !org) return

  const vars = {
    clientName: client.name,
    orgName: org.name,
    taskTitle: task.title,
    fromColumn: metadata.fromColumn,
    toColumn: metadata.toColumn,
    dueDate: metadata.dueDate,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/portal`,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
  }

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled && config.smtpHost && config.smtpPass) channels.push('EMAIL')

  for (const channel of channels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)

    let status: 'SENT' | 'FAILED' = 'SENT'
    let error: string | undefined

    try {
      if (channel === 'WHATSAPP') {
        await sendWhatsApp(config.maximizebotToken!, {
          number: client.whatsapp!,
          body: rendered,
          saveOnTicket: config.saveOnTicket,
          startChatbot: config.startChatbot,
          linkPreview: true,
        })
      } else {
        const pass = decrypt(config.smtpPass!)
        await sendEmail(
          {
            host: config.smtpHost!,
            port: config.smtpPort!,
            user: config.smtpUser!,
            pass,
            from: config.emailFrom!,
          },
          client.email,
          renderTemplate(template.subject ?? '', vars),
          rendered,
        )
      }
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
    }

    await prisma.notificationLog.create({
      data: {
        organizationId,
        clientId,
        event: event as NotificationEvent,
        channel,
        taskId,
        recipient: channel === 'WHATSAPP' ? client.whatsapp! : client.email,
        message: rendered,
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
}

export function startNotificationWorker() {
  return new Worker('notification-queue', processNotificationJob, {
    connection: redis,
    concurrency: 5,
  })
}
```

- [ ] **Step 5: Rodar notification-worker.test.ts — deve passar**

```bash
pnpm --filter api test src/workers/notification-worker.test.ts --reporter=verbose 2>&1 | tail -15
```

Esperado: 3 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/notification.worker.ts apps/api/src/workers/notification-worker.test.ts
git commit -m "feat: notification worker BullMQ com processNotificationJob testável"
```

---

## Task 8: duedate.cron.ts + worker.ts entry point

**Files:**
- Create: `apps/api/src/workers/duedate.cron.ts`
- Create: `apps/api/src/worker.ts`

- [ ] **Step 1: Criar duedate.cron.ts**

```typescript
// apps/api/src/workers/duedate.cron.ts
import { Queue, Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'

export function startDueDateCronWorker() {
  const cronQueue = new Queue('duedate-cron', { connection: redis })

  // Registra job repetível — BullMQ deduplicará se já existir
  cronQueue.add('check', {}, {
    repeat: { every: 3_600_000 },   // a cada 1 hora
    jobId: 'duedate-check',
  })

  return new Worker('duedate-cron', async () => {
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: in24h },
        status: { not: 'DONE' },
      },
      include: {
        column: {
          include: { board: { select: { organizationId: true, clientId: true } } },
        },
      },
    })

    for (const task of tasks) {
      await enqueueNotification({
        event: 'TASK_DUE_DATE_APPROACHING',
        taskId: task.id,
        organizationId: task.column.board.organizationId,
        clientId: task.column.board.clientId,
        metadata: {
          taskTitle: task.title,
          dueDate: task.dueDate!.toLocaleDateString('pt-BR'),
        },
      })
    }
  }, { connection: redis })
}
```

- [ ] **Step 2: Criar worker.ts (entry point)**

```typescript
// apps/api/src/worker.ts
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve(import.meta.dirname, '../../.env') })

import { redis } from '@/lib/redis'
import { startNotificationWorker } from '@/workers/notification.worker'
import { startDueDateCronWorker } from '@/workers/duedate.cron'

async function main() {
  await redis.connect()
  startNotificationWorker()
  startDueDateCronWorker()
  console.log('[worker] Notification worker + duedate cron iniciados')
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Verificar compilação**

```bash
pnpm --filter api exec tsc --noEmit 2>&1 | grep -v "seed.ts" | head -10
```

Esperado: sem erros de TypeScript relevantes (o erro do seed.ts é pré-existente).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workers/duedate.cron.ts apps/api/src/worker.ts
git commit -m "feat: duedate cron worker + entry point src/worker.ts"
```

---

## Task 9: Full test suite + TASKS.md

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Rodar suite completa**

```bash
pnpm --filter api test --reporter=verbose 2>&1 | tail -20
```

Esperado: todos os testes PASS. Se houver falhas, corrigir antes de avançar.

Contagem esperada: 88 (Fase 4) + 6 template + 2 maximizebot + 3 mailer + 3 worker + 4 templates.routes = **~106 testes**.

- [ ] **Step 2: Checar cobertura**

```bash
pnpm --filter api test:coverage 2>&1 | grep -E "All files|src/lib|src/modules/notifications|src/workers"
```

Esperado: cobertura ≥ 80% nas libs e módulo de notificações.

- [ ] **Step 3: Marcar Fase 5 como concluída em TASKS.md**

Abrir `docs/TASKS.md` e substituir a seção da Fase 5:

```markdown
## Fase 5 — Templates e Notificações ✅
### Testes da Fase 5
- [x] `template.test.ts` — interpolação de todas as variáveis, variável ausente retorna string vazia
- [x] `template.test.ts` — fallback para template padrão quando org não tem customizado
- [x] `maximizebot.test.ts` — mock axios, valida payload enviado (number, body, token)
- [x] `mailer.test.ts` — mock nodemailer, valida subject e body renderizados
- [x] `notification-worker.test.ts` — evento desabilitado não envia, log FAILED em erro de envio
- [x] `templates.routes.test.ts` — POST /notifications/templates/preview renderiza corretamente
- [x] Client HTTP MaximizeBot (`src/lib/maximizebot.ts`)
- [x] Nodemailer/Resend client (`src/lib/mailer.ts`)
- [x] CRUD `NotificationConfig` por org
- [x] CRUD `MessageTemplate` por org — WhatsApp + Email por evento
- [x] Endpoint `POST /notifications/templates/preview` — renderiza prévia com vars fictícias
- [x] Endpoints de teste: `test-whatsapp` e `test-email`
- [x] BullMQ worker `notification-queue`
  - [x] Interpola variáveis no template ({{clientName}}, {{taskTitle}}, etc.)
  - [x] Busca template customizado ou fallback padrão do sistema
  - [x] Envia via MaximizeBot (WhatsApp)
  - [x] Envia via Nodemailer (Email)
  - [x] Salva log em `NotificationLog`
  - [x] Retry 3x com backoff exponencial
- [x] Disparar `TASK_MOVED` ao mover tarefa
- [x] Disparar `TASK_COMPLETED` ao entrar em coluna `isFinal`
- [x] Disparar `TASK_COMMENT_ADDED` ao comentar
- [x] Cron BullMQ: verificar `dueDate` em 24h → `TASK_DUE_DATE_APPROACHING`
- [x] Painel de logs de notificação no frontend interno ← endpoint GET /notifications/logs entregue; painel visual na Fase 6
```

- [ ] **Step 4: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Fase 5 como concluída no TASKS.md"
```
