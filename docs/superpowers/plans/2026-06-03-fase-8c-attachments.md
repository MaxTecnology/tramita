# Fase 8c: Anexos Backblaze B2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload, listagem (com signed URL) e remoção de anexos de tarefas via Backblaze B2, com dropzone no modal de tarefa interno e visualização no portal.

**Architecture:** Backend usa `@fastify/multipart` para receber arquivos (max 20MB), valida tipo MIME, faz upload ao B2 via SDK S3-compatible, salva metadados na tabela `attachments`. `GET` retorna lista com signed URLs TTL 1h via `getSignedUrl`. Frontend usa input `type=file` no TaskModal para upload e lista links de download no TaskDrawer do portal.

**Tech Stack:** `@fastify/multipart`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, React `input[type=file]`.

---

## File Map

**Backend — criar:**
- `apps/api/src/lib/b2.ts` — S3Client B2 + `uploadFile`, `getSignedDownloadUrl`, `deleteFile`
- `apps/api/src/modules/attachments/attachments.schema.ts` — params schema
- `apps/api/src/modules/attachments/attachments.service.ts` — `createAttachment`, `listAttachments`, `deleteAttachment`
- `apps/api/src/modules/attachments/attachments.routes.ts` — 3 rotas
- `apps/api/src/modules/attachments/attachments.service.test.ts` ← OBRIGATÓRIO
- `apps/api/src/modules/attachments/attachments.routes.test.ts` ← OBRIGATÓRIO

**Backend — modificar:**
- `apps/api/src/server.ts` — registrar `attachmentsRoutes`

**Frontend — modificar:**
- `apps/web/src/components/TaskModal.tsx` — adicionar dropzone de upload
- `apps/web/src/components/portal/TaskDrawer.tsx` — adicionar lista de anexos com download

---

## Task 1: Backend — B2 lib + attachments module (TDD)

**Files:**
- Create: `apps/api/src/lib/b2.ts`
- Create: `apps/api/src/modules/attachments/attachments.schema.ts`
- Create: `apps/api/src/modules/attachments/attachments.service.ts`
- Create: `apps/api/src/modules/attachments/attachments.service.test.ts`

- [ ] **Step 1: Instalar dependências**

```bash
pnpm --filter api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @fastify/multipart
```

- [ ] **Step 2: Criar o teste PRIMEIRO**

`apps/api/src/modules/attachments/attachments.service.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as b2Module from '@/lib/b2'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'
import { createAttachment, listAttachments, deleteAttachment } from '@/modules/attachments/attachments.service'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('attachments.service', () => {
  it('createAttachment saves metadata and returns storageKey', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const result = await createAttachment(
      task.id,
      org.id,
      user.id,
      { filename: 'doc.pdf', mimeType: 'application/pdf', size: 1024, buffer: Buffer.from('') },
    )

    expect(result.filename).toBe('doc.pdf')
    expect(result.storageKey).toContain(task.id)
    expect(b2Module.uploadFile).toHaveBeenCalledOnce()
  })

  it('listAttachments returns signed download URLs', async () => {
    vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url/file')

    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await createAttachment(task.id, org.id, user.id, {
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      buffer: Buffer.from(''),
    })

    const list = await listAttachments(task.id, org.id)
    expect(list).toHaveLength(1)
    expect(list[0].signedUrl).toBe('https://signed-url/file')
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/attachments/attachments.service.test.ts 2>&1 | tail -5
```

Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Criar `apps/api/src/lib/b2.ts`**

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const b2 = new S3Client({
  endpoint: process.env.B2_ENDPOINT ?? 'https://s3.us-west-004.backblazeb2.com',
  region: process.env.B2_BUCKET_REGION ?? 'us-west-004',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID ?? '',
    secretAccessKey: process.env.B2_APP_KEY ?? '',
  },
})

const BUCKET = process.env.B2_BUCKET_NAME ?? 'tramita'

export async function uploadFile(key: string, body: Buffer, mimeType: string): Promise<void> {
  await b2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mimeType }))
}

export async function getSignedDownloadUrl(key: string, ttlSeconds = 3600): Promise<string> {
  return getSignedUrl(b2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds })
}

export async function deleteFile(key: string): Promise<void> {
  await b2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}
```

- [ ] **Step 5: Criar `apps/api/src/modules/attachments/attachments.schema.ts`**

```typescript
import { z } from 'zod'

export const attachmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const deleteAttachmentParamsSchema = z.object({
  id: z.string().cuid(),
  attachmentId: z.string().cuid(),
})
```

- [ ] **Step 6: Criar `apps/api/src/modules/attachments/attachments.service.ts`**

```typescript
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

async function verifyTaskBelongsToOrg(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return task
}

export async function createAttachment(
  taskId: string,
  organizationId: string,
  uploadedBy: string,
  payload: UploadPayload,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const storageKey = `attachments/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  return prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy,
    },
  })
}

export async function listAttachments(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })

  return Promise.all(
    attachments.map(async (a) => ({
      ...a,
      signedUrl: await getSignedDownloadUrl(a.storageKey),
    })),
  )
}

export async function deleteAttachment(
  attachmentId: string,
  taskId: string,
  organizationId: string,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  await deleteFile(attachment.storageKey)
  await prisma.attachment.delete({ where: { id: attachmentId } })
  return { ok: true }
}
```

- [ ] **Step 7: Rodar — deve passar**

```bash
pnpm --filter api test src/modules/attachments/attachments.service.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 2 testes PASS.

- [ ] **Step 8: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/api/src/lib/b2.ts apps/api/src/modules/attachments/ pnpm-lock.yaml
git -C /home/max/job/autohubs/tramita commit -m "feat: attachments service + B2 lib (TDD)"
```

---

## Task 2: Backend — attachments routes (TDD)

**Files:**
- Create: `apps/api/src/modules/attachments/attachments.routes.ts`
- Create: `apps/api/src/modules/attachments/attachments.routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o teste PRIMEIRO**

`apps/api/src/modules/attachments/attachments.routes.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import * as b2Module from '@/lib/b2'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed-url')
  vi.spyOn(b2Module, 'deleteFile').mockResolvedValue(undefined)
})

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const client = await createTestClient(org.id)
  const board = await createTestBoard(org.id, client.id)
  const col = await createTestColumn(board.id, { position: 0 })
  const task = await createTestTask(col.id, user.id)
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { task, user, org, auth }
}

describe('POST /tasks/:id/attachments', () => {
  it('rejects file above 20MB', async () => {
    const { task, auth } = await setup()

    // Build a 21MB multipart body (simulated)
    const boundary = 'boundary123'
    const bigContent = 'x'.repeat(21 * 1024 * 1024)
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.pdf"\r\nContent-Type: application/pdf\r\n\r\n${bigContent}\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    expect(res.statusCode).toBe(413)
  })

  it('rejects disallowed MIME type', async () => {
    const { task, auth } = await setup()

    const boundary = 'boundary456'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hack.exe"\r\nContent-Type: application/x-msdownload\r\n\r\nMZcontent\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    expect(res.statusCode).toBe(422)
  })

  it('uploads allowed file type and returns 201', async () => {
    const { task, auth } = await setup()

    const boundary = 'boundary789'
    const content = 'PDF content'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n${content}\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/attachments`,
      headers: {
        authorization: auth,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).filename).toBe('doc.pdf')
  })
})

describe('GET /tasks/:id/attachments', () => {
  it('returns attachments with signed URLs', async () => {
    const { task, auth } = await setup()

    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}/attachments`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/attachments/attachments.routes.test.ts 2>&1 | tail -5
```

Expected: FAIL — rota não existe.

- [ ] **Step 3: Criar `apps/api/src/modules/attachments/attachments.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createAttachment, listAttachments, deleteAttachment } from './attachments.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
])

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }

    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number }
      if (e?.statusCode === 413) throw new AppError(413, 'Arquivo excede o limite de 20MB')
      throw err
    }

    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppError(422, 'Tipo de arquivo não permitido')
    }

    const buffer = await file.toBuffer()

    // Double-check size after buffer (multipart limit may not always fire)
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const attachment = await createAttachment(
      taskId,
      request.user.organizationId!,
      request.user.sub,
      {
        filename: file.filename,
        mimeType: file.mimetype,
        size: buffer.length,
        buffer,
      },
    )

    return reply.status(201).send(attachment)
  })

  app.get('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }
    return reply.send(await listAttachments(taskId, request.user.organizationId!))
  })

  app.delete('/tasks/:id/attachments/:attachmentId', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId, attachmentId } = request.params as { id: string; attachmentId: string }
    return reply.status(204).send(
      await deleteAttachment(attachmentId, taskId, request.user.organizationId!),
    )
  })
}
```

- [ ] **Step 4: Registrar em `apps/api/src/server.ts`**

Adicionar import:
```typescript
import { attachmentsRoutes } from '@/modules/attachments/attachments.routes'
```

Adicionar registro (após `streamRoutes`):
```typescript
app.register(attachmentsRoutes)
```

- [ ] **Step 5: Rodar — deve passar**

```bash
pnpm --filter api test src/modules/attachments/attachments.routes.test.ts --reporter=verbose 2>&1 | tail -12
```

Expected: 4 testes PASS.

- [ ] **Step 6: Suite completa**

```bash
pnpm --filter api test 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/api/src/modules/attachments/attachments.routes.ts apps/api/src/modules/attachments/attachments.routes.test.ts apps/api/src/server.ts
git -C /home/max/job/autohubs/tramita commit -m "feat: attachments routes — upload/list/delete com validação 20MB e MIME (TDD)"
```

---

## Task 3: Frontend — dropzone no TaskModal + lista no TaskDrawer

**Files:**
- Modify: `apps/web/src/components/TaskModal.tsx`
- Modify: `apps/web/src/components/portal/TaskDrawer.tsx`

- [ ] **Step 1: Atualizar `apps/web/src/components/TaskModal.tsx`**

Ler o arquivo atual. Adicionar imports e seção de anexos.

Adicionar imports:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
```

Adicionar interface de anexo (após os imports):
```typescript
interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  signedUrl: string
  createdAt: string
}
```

Dentro da função `TaskModal`, adicionar após os estados existentes:
```typescript
const { data: attachments = [] } = useQuery<Attachment[]>({
  queryKey: ['attachments', task.id],
  queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
  enabled: open,
})

const uploadMutation = useMutation({
  mutationFn: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/tasks/${task.id}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
})

const deleteMutation = useMutation({
  mutationFn: (attachmentId: string) =>
    api.delete(`/tasks/${task.id}/attachments/${attachmentId}`),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
})
```

No JSX, adicionar seção de anexos antes dos botões Cancelar/Salvar:
```typescript
<div className="mt-4">
  <Label>Anexos</Label>
  <div className="mt-1 space-y-1">
    {attachments.map((a) => (
      <div key={a.id} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
        <a
          href={a.signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline truncate max-w-[240px]"
        >
          {a.filename}
        </a>
        <button
          type="button"
          onClick={() => deleteMutation.mutate(a.id)}
          className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
        >
          Remover
        </button>
      </div>
    ))}
  </div>
  <label className="mt-2 flex items-center gap-2 cursor-pointer">
    <input
      type="file"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) uploadMutation.mutate(file)
        e.target.value = ''
      }}
    />
    <span className="text-xs text-blue-600 hover:underline">
      {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
    </span>
  </label>
</div>
```

- [ ] **Step 2: Atualizar `apps/web/src/components/portal/TaskDrawer.tsx`**

Ler o arquivo atual. Adicionar a lista de anexos para o portal (apenas leitura + download).

Adicionar interface de anexo (após o import de `Task`):
```typescript
interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  signedUrl: string
}
```

Adicionar query de attachments após a query de histórico:
```typescript
const { data: attachments = [] } = useQuery<Attachment[]>({
  queryKey: ['attachments', task.id],
  queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
})
```

No JSX, adicionar seção de anexos antes da seção de comentários:
```typescript
{attachments.length > 0 && (
  <div>
    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Anexos</h3>
    <div className="space-y-1">
      {attachments.map((a) => (
        <a
          key={a.id}
          href={a.signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
        >
          <span className="text-gray-400">📎</span>
          {a.filename}
        </a>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

- [ ] **Step 4: Rodar testes**

```bash
pnpm --filter web test 2>&1 | tail -5
```

Expected: 12 passando.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/TaskModal.tsx apps/web/src/components/portal/TaskDrawer.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: anexos — dropzone no TaskModal, lista no TaskDrawer do portal"
```

---

## Task 4: TASKS.md

- [ ] **Step 1: Rodar suites completas**

```bash
pnpm --filter api test 2>&1 | tail -5 && pnpm --filter web test 2>&1 | tail -5
```

- [ ] **Step 2: Atualizar TASKS.md**

Marcar no header da Fase 8:
```markdown
- [x] `attachments.service.test.ts` — mock B2 client, valida storageKey e signed URL
- [x] `attachments.routes.test.ts` — rejeita arquivo acima de 20MB, tipo não permitido
```

Marcar `### 8c — Anexos (Backblaze B2)` como `✅` e todos os itens como `[x]`.

- [ ] **Step 3: Commit**

```bash
git -C /home/max/job/autohubs/tramita add docs/TASKS.md
git -C /home/max/job/autohubs/tramita commit -m "docs: Fase 8c Anexos B2 concluída no TASKS.md"
```

---

## Self-Review

### Spec coverage
| Requisito | Task |
|---|---|
| `attachments.service.test.ts` — mock B2, storageKey, signed URL | Task 1 |
| `attachments.routes.test.ts` — rejeita >20MB, tipo não permitido | Task 2 |
| `POST /tasks/:id/attachments` multipart max 20MB | Task 2 |
| `GET /tasks/:id/attachments` lista com signedUrl TTL 1h | Tasks 1+2 |
| `DELETE /tasks/:id/attachments/:attachmentId` | Task 2 |
| Frontend: dropzone no modal da tarefa | Task 3 |
| Portal: visualização e download de anexos | Task 3 |

### Type consistency
`UploadPayload` usado em `createAttachment` é definido inline em `attachments.service.ts` — consistente com o mock no teste.
`Attachment` interface no frontend espelha os campos retornados pelo service (com `signedUrl` adicionado).
