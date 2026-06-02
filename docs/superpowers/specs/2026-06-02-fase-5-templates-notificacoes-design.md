# Spec — Fase 5: Templates e Notificações

**Data:** 2026-06-02  
**Escopo:** Sistema completo de notificações: libs de envio (MaximizeBot + Nodemailer), interpolação de templates, CRUD de configuração e templates por org, BullMQ worker com retry, cron de dueDate, disparos automáticos nas mutações de tarefas/comentários e 6 arquivos de teste.

---

## Contexto

- Schema já migrado: `NotificationConfig`, `MessageTemplate`, `NotificationLog`, `NotificationEvent`, `MessageChannel` existem no banco.
- `src/lib/queue.ts` existe como stub no-op — será substituído pela implementação real do BullMQ.
- `bullmq` e `axios` já instalados. `nodemailer` ainda não instalado.
- Os services de `tasks` e `comments` já chamam `enqueueNotification()` — nenhuma alteração necessária neles.

---

## Novos arquivos em `src/lib/`

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/template.ts` | `renderTemplate(body, vars)` — substitui `{{var}}` por valor ou `''` se ausente |
| `src/lib/default-templates.ts` | Constantes de fallback `DEFAULT_TEMPLATES[event][channel]` |
| `src/lib/maximizebot.ts` | `sendWhatsApp(token, payload)` — wrapper axios para MaximizeBot API |
| `src/lib/mailer.ts` | `sendEmail(config, to, subject, body)` — wrapper nodemailer SMTP |
| `src/lib/encryption.ts` | `encrypt(text)` / `decrypt(text)` — AES-256-GCM para `smtpPass` em repouso |
| `src/lib/queue.ts` *(substituir stub)* | `enqueueNotification(job)` — BullMQ `Queue` real |

---

## `src/lib/template.ts`

```typescript
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

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof TemplateVars] ?? '')
}
```

---

## `src/lib/default-templates.ts`

Templates hardcoded de fallback. Estrutura: `DEFAULT_TEMPLATES[NotificationEvent][MessageChannel]`.

```typescript
import type { NotificationEvent, MessageChannel } from '@prisma/client'

type TemplateMap = Record<NotificationEvent, Partial<Record<MessageChannel, { subject?: string; body: string }>>>

export const DEFAULT_TEMPLATES: TemplateMap = {
  TASK_CREATED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Um novo processo *{{taskTitle}}* foi aberto para você.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo processo aberto — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nUm novo processo foi aberto: *{{taskTitle}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_MOVED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Atualização no processo — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* avançou de *{{fromColumn}}* para *{{toColumn}}*.\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMPLETED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Seu processo *{{taskTitle}}* foi concluído! 🎉\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Processo concluído — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nSeu processo *{{taskTitle}}* foi concluído com sucesso!\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_COMMENT_ADDED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Novo comentário no processo *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo comentário — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nNovo comentário no processo *{{taskTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe em: {{portalUrl}}' },
  },
  TASK_DUE_DATE_APPROACHING: {
    WHATSAPP: { body: 'Olá, {{clientName}}! O processo *{{taskTitle}}* vence em {{dueDate}}. Acesse: {{portalUrl}}' },
    EMAIL: { subject: 'Prazo se aproximando — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nO processo *{{taskTitle}}* vence em {{dueDate}}.\n\nAcompanhe em: {{portalUrl}}' },
  },
}
```

---

## `src/lib/maximizebot.ts`

Wrapper axios conforme documentado no CLAUDE.md:

```typescript
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

`token` vem de `NotificationConfig.maximizebotToken` (formato `"Bearer <TOKEN>"`).

---

## `src/lib/mailer.ts`

```typescript
import nodemailer from 'nodemailer'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string     // já decriptografado pelo service antes de passar aqui
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

Dependência: `nodemailer` + `@types/nodemailer` (instalar no momento da implementação).

---

## `src/lib/encryption.ts`

AES-256-GCM para `smtpPass` em repouso. Chave via `ENCRYPTION_KEY` (hex 64 chars = 32 bytes):

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex')

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encoded: string): string {
  const [ivHex, tagHex, encHex] = encoded.split(':')
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
}
```

`ENCRYPTION_KEY` deve ser adicionado ao `.env` e `.env.example`.

---

## `src/lib/queue.ts` (substituir stub)

```typescript
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

**Nota:** `redis` em `src/lib/redis.ts` usa `lazyConnect: true` — o Queue conecta sob demanda, sem necessidade de `await redis.connect()` explícito para enfileirar.

---

## Módulo `src/modules/notifications/`

```
notifications.schema.ts
notifications.service.ts
notifications.routes.ts
```

### Endpoints

| Método | Path | Role | Descrição |
|--------|------|------|-----------|
| GET | `/notifications/config` | ORG_ADMIN | Retorna config atual da org |
| PATCH | `/notifications/config` | ORG_ADMIN | Atualiza config (criptografa smtpPass) |
| POST | `/notifications/config/test-whatsapp` | ORG_ADMIN | Envia mensagem de teste |
| POST | `/notifications/config/test-email` | ORG_ADMIN | Envia email de teste |
| GET | `/notifications/templates` | ORG_ADMIN | Lista todos os templates da org |
| GET | `/notifications/templates/:event/:channel` | ORG_ADMIN | Template customizado ou default |
| PUT | `/notifications/templates/:event/:channel` | ORG_ADMIN | Cria ou atualiza template |
| DELETE | `/notifications/templates/:event/:channel` | ORG_ADMIN | Remove template customizado |
| POST | `/notifications/templates/preview` | ORG_ADMIN | Renderiza template com vars fictícias |
| GET | `/notifications/logs` | ORG_ADMIN | Lista logs com filtros (page, limit, status, channel) |

### `notifications.service.ts` — regras

**Config:**
- `getConfig`: retorna `NotificationConfig` da org (ou objeto vazio/defaults se não existe).
- `updateConfig`: upsert. Se `smtpPass` presente → `encrypt(smtpPass)` antes de persistir.

**Templates:**
- `getTemplate(orgId, event, channel)`: busca `MessageTemplate` da org; se não encontrar → retorna `DEFAULT_TEMPLATES[event][channel]`.
- `upsertTemplate`: cria ou atualiza via `@@unique([organizationId, event, channel])`.
- `deleteTemplate`: remove entrada customizada (org volta a usar o default).

**Preview:**
- `previewTemplate(orgId, event, channel, body?)`: usa `body` se fornecido, senão busca template via `getTemplate`. Renderiza com `PREVIEW_VARS` (vars fictícias hardcoded).

**Logs:**
- `listLogs(orgId, filters)`: pagina `NotificationLog` com filtros opcionais `status`, `channel`.

### `notifications.schema.ts`

```typescript
updateConfigSchema = z.object({
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

upsertTemplateSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
})

previewSchema = z.object({
  event: z.nativeEnum(NotificationEvent),
  channel: z.nativeEnum(MessageChannel),
  body: z.string().optional(),
})

testWhatsappSchema = z.object({ number: z.string().min(10) })
testEmailSchema = z.object({ to: z.string().email() })
```

---

## Worker `src/workers/notification.worker.ts`

```typescript
import { Worker } from 'bullmq'
import { redis } from '@/lib/redis'
// ... imports

export function startNotificationWorker() {
  return new Worker('notification-queue', async (job) => {
    const { event, taskId, organizationId, clientId, metadata } = job.data as NotificationJob

    const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
    if (!config) return  // org sem config → silencioso

    const isEventEnabled = config[EVENT_FLAG_MAP[event]] as boolean | undefined
    if (!isEventEnabled) return  // evento desabilitado → não envia

    const [client, task, org] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId } }),
      prisma.task.findUnique({ where: { id: taskId } }),
      prisma.organization.findUnique({ where: { id: organizationId } }),
    ])
    if (!client || !task || !org) return

    const vars: TemplateVars = {
      clientName: client.name,
      orgName: org.name,
      taskTitle: task.title,
      fromColumn: metadata.fromColumn,
      toColumn: metadata.toColumn,
      dueDate: metadata.dueDate,
      portalUrl: `${process.env.APP_URL}/portal`,
      commentText: metadata.commentText,
      commentAuthorName: metadata.commentAuthorName,
    }

    const channels: MessageChannel[] = []
    if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
    if (config.emailEnabled && config.smtpHost) channels.push('EMAIL')

    for (const channel of channels) {
      const template = await getTemplate(organizationId, event as NotificationEvent, channel)
      // getTemplate importado de notifications.service.ts
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
          const smtpPass = decrypt(config.smtpPass!)
          await sendEmail(
            { host: config.smtpHost!, port: config.smtpPort!, user: config.smtpUser!, pass: smtpPass, from: config.emailFrom! },
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
  }, {
    connection: redis,
    concurrency: 5,
  })
}
```

**`getEventFlag(config, event)`** — mapeamento de `event` string para o campo booleano da config:
```typescript
const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
}
```

---

## Entry point do worker `src/worker.ts`

Arquivo separado do `src/app.ts` — rodado como processo independente:

```typescript
import { config } from 'dotenv'
import { resolve } from 'node:path'
config({ path: resolve(import.meta.dirname, '../../.env') })

import { redis } from '@/lib/redis'
import { startNotificationWorker } from '@/workers/notification.worker'
import { startDueDateCronWorker } from '@/workers/duedate.cron'

async function main() {
  await redis.connect()
  startNotificationWorker()
  startDueDateCronWorker()
  console.log('Workers iniciados')
}

main()
```

Script no `package.json`: `"worker": "tsx src/worker.ts"`.

---

## Cron `src/workers/duedate.cron.ts`

BullMQ `repeat` job rodado a cada hora. Busca tarefas com `dueDate` entre `now` e `now + 24h` com `status != DONE` e enfileira um job `TASK_DUE_DATE_APPROACHING` para cada uma.

```typescript
import { Queue, Worker } from 'bullmq'
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'

export function startDueDateCronWorker() {
  const cronQueue = new Queue('duedate-cron', { connection: redis })

  cronQueue.add('check', {}, { repeat: { every: 3_600_000 } })

  return new Worker('duedate-cron', async () => {
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const tasks = await prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: in24h },
        status: { not: 'DONE' },
      },
      include: {
        column: { include: { board: { select: { organizationId: true, clientId: true } } } },
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

---

## Registro em `server.ts`

```typescript
import { notificationsRoutes } from '@/modules/notifications/notifications.routes'
app.register(notificationsRoutes, { prefix: '/notifications' })
```

---

## Testes da Fase 5

### `src/lib/template.test.ts`
- `renderTemplate` substitui todas as variáveis corretamente
- Variável ausente nos vars → substituída por string vazia (não lança erro)
- Variável não presente no body → permanece inalterada (sem `{{var}}` no body → nada muda)
- `DEFAULT_TEMPLATES.TASK_MOVED.WHATSAPP.body` contém `{{fromColumn}}` e `{{toColumn}}`
- `getTemplate` retorna default quando org não tem template customizado

### `src/lib/maximizebot.test.ts`
- Mock axios: valida que `POST` foi chamado com `number`, `body` e header `Authorization: <token>`
- Mock axios: erro de rede → função lança o erro (sem swallow)

### `src/lib/mailer.test.ts`
- Mock `nodemailer.createTransport`: valida que `sendMail` foi chamado com `to`, `subject`, `text`
- Erro SMTP → função lança o erro

### `src/workers/notification-worker.test.ts`
- Evento desabilitado na config (`taskMoved: false`) → nenhum send chamado, nenhum log criado
- Erro de envio → `NotificationLog.status = 'FAILED'`, `error` preenchido
- Org sem `NotificationConfig` → job finaliza silenciosamente sem erro

### `src/modules/notifications/templates.routes.test.ts`
- `POST /notifications/templates/preview` com body customizado → retorna `{ rendered: "..." }` com vars substituídas
- `POST /notifications/templates/preview` sem body → usa template default do evento/canal
- `PUT /notifications/templates/:event/:channel` → persiste e retorna o template
- `GET /notifications/templates/:event/:channel` para org sem template → retorna o default

---

## Variáveis de ambiente a adicionar

```env
# Criptografia SMTP (AES-256 — gerar com: openssl rand -hex 32)
ENCRYPTION_KEY=<64 chars hex>
```

Adicionar ao `.env.example`.

---

## Checklist de conclusão (critério da Fase 5)

- [ ] `pnpm --filter api test` verde (inclui os 6 novos arquivos de teste)
- [ ] `enqueueNotification` real: mover uma tarefa enfileira job no Redis
- [ ] Worker processa job: log aparece em `notification_logs` com `status = SENT` (ou `FAILED` se credenciais inválidas)
- [ ] Cron: job `duedate-cron` aparece no Redis com repeat
- [ ] `POST /notifications/templates/preview` retorna preview renderizado
- [ ] `smtpPass` salvo no banco criptografado (prefixo `iv:tag:encrypted`)
