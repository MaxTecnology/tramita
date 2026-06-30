# CLAUDE.md — Tramita

> SaaS da AutoHubs para acompanhamento de processos entre escritórios contábeis e seus clientes — qualquer fluxo de trabalho do escritório (legalização, fiscal, folha de pagamento, etc.), não só um tipo específico.

## Contexto do Produto

**Tramita** é um SaaS B2B multi-tenant com três camadas de acesso:

1. **AutoHubs (Master)** — você (Max). Configura planos, onboarda escritórios, monitora receita e assinaturas Asaas.
2. **Escritório Contábil (Organization)** — tenant pagante. Gerencia seus processos internos e os clientes dele via Kanban.
3. **Cliente Final** — acessa portal read-only para acompanhar andamento dos processos, podendo comentar.

Documentação completa:
- `ARCHITECTURE.md` — visão geral, stack, fluxos, modelo de billing
- `SCHEMA.md` — schema Prisma completo (Organization, Plan, MessageTemplate, etc.)
- `SPEC.md` — todos os endpoints, payloads, worker de notificações
- `TASKS.md` — checklist de implementação em 9 fases

---

## Stack

- **Backend:** Node.js 22 + TypeScript strict + Fastify v5 + Prisma v6 + BullMQ + Redis
- **Frontend:** React 19 + Vite + TailwindCSS v4 + shadcn/ui + @dnd-kit/core
- **WhatsApp:** MaximizeBot API (`POST https://app.maximizebot.com.br/backend/api/messages/send`)
- **Email:** Nodemailer (SMTP configurável por escritório)
- **Billing:** Asaas (assinaturas recorrentes + webhooks)
- **Storage:** Backblaze B2
- **PDF:** Puppeteer
- **Infra:** Docker + Dokploy + Traefik

---

## Convenções

- Comentários e variáveis em **inglês**, mensagens de usuário em **português (pt-BR)**
- TypeScript `strict: true` — sem `any`, sem `as unknown`
- Validação Zod em todas as entradas (body, params, query)
- Erros via `AppError` customizado com `statusCode` + `message`
- Logs via Pino — nunca `console.log` em produção
- Path aliases: `@/` → `src/`

---

## Estrutura de Módulo (obrigatória)

```
src/modules/<nome>/
  <nome>.routes.ts    // rotas Fastify + preHandler de auth
  <nome>.service.ts   // lógica de negócio (único ponto de acesso ao Prisma)
  <nome>.schema.ts    // schemas Zod
  <nome>.types.ts     // types derivados dos schemas
```

---

## Middlewares Críticos

| Middleware          | Onde aplicar                        | O que faz                                      |
|---------------------|-------------------------------------|------------------------------------------------|
| `verifyJWT`         | Todas as rotas autenticadas         | Valida e decodifica JWT RS256                  |
| `verifyOrg`         | Rotas de org (`/boards`, `/tasks`)  | Valida `organizationId` do token vs recurso    |
| `checkSubscription` | Rotas de mutação (POST/PATCH/DELETE)| Bloqueia se `subscriptionStatus = SUSPENDED`   |
| `checkPlanLimit`    | `POST /clients`                     | Valida `clientsCount < plan.maxClients`        |
| `requireRole`       | Rotas por perfil                    | Valida role mínimo necessário                  |

---

## Interpolação de Templates de Mensagem

Variáveis disponíveis para templates (WhatsApp e Email):

```typescript
interface TemplateVars {
  clientName: string       // Nome do cliente final
  orgName: string          // Nome do escritório
  taskTitle: string        // Título da tarefa/processo
  fromColumn?: string      // Etapa anterior (task.moved)
  toColumn?: string        // Nova etapa (task.moved)
  dueDate?: string         // Data de vencimento formatada (dd/MM/yyyy)
  portalUrl: string        // https://tramita.autohubs.com.br/portal
  commentText?: string     // Texto do comentário (comment_added)
  commentAuthorName?: string
}
```

Função de interpolação (`src/lib/template.ts`):
```typescript
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key as keyof TemplateVars] ?? '')
}
```

---

## Client MaximizeBot (`src/lib/maximizebot.ts`)

```typescript
import axios from 'axios'

interface SendMessagePayload {
  number: string
  body: string
  saveOnTicket?: boolean
  startChatbot?: boolean
  linkPreview?: boolean
  mediaType?: 'image' | 'video' | 'audio' | 'document'
  mediaPath?: string
}

export async function sendWhatsApp(token: string, payload: SendMessagePayload) {
  return axios.post(
    'https://app.maximizebot.com.br/backend/api/messages/send',
    payload,
    { headers: { Authorization: token, 'Content-Type': 'application/json' } }
  )
}
```

O `token` vem de `NotificationConfig.maximizebotToken` da organização (formato: `"Bearer <TOKEN>"`).

---

## Client Backblaze B2 (`src/lib/b2.ts`)

Backblaze B2 é S3-compatible — usar o SDK `@aws-sdk/client-s3` com endpoint customizado.

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const b2 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,         // https://s3.us-west-004.backblazeb2.com
  region: process.env.B2_BUCKET_REGION,      // us-west-004
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APP_KEY!,
  },
})

export async function uploadFile(key: string, body: Buffer, mimeType: string) {
  await b2.send(new PutObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: mimeType,
  }))
}

export async function getSignedDownloadUrl(key: string, ttlSeconds = 3600) {
  return getSignedUrl(b2, new GetObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
  }), { expiresIn: ttlSeconds })
}

export async function deleteFile(key: string) {
  await b2.send(new DeleteObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
  }))
}
```

Dependências: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.

---

## Variáveis de Ambiente

```env
# Banco
DATABASE_URL=postgresql://user:pass@localhost:5432/tramita

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_PRIVATE_KEY=<RS256 PEM — \n como separador de linha>
JWT_PUBLIC_KEY=<RS256 PEM — \n como separador de linha>

# Asaas
ASAAS_API_KEY=<chave da conta AutoHubs no Asaas>
ASAAS_BASE_URL=https://api.asaas.com/v3
ASAAS_WEBHOOK_SECRET=<secret para validar payload>

# Backblaze B2
B2_KEY_ID=<applicationKeyId do plano B2>
B2_APP_KEY=<applicationKey do plano B2>
B2_BUCKET_NAME=tramita
B2_BUCKET_REGION=us-west-004
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com

# App
PORT=3000
NODE_ENV=development
APP_URL=https://tramita.autohubs.com.br
# Rotas internas (usadas para montar links em emails/WhatsApp)
APP_PORTAL_PATH=/portal
APP_MASTER_PATH=/master

# Criptografia (SMTP passwords no banco)
ENCRYPTION_KEY=<32 bytes hex — AES-256>
```

---

## Testes

### Setup
```bash
# Banco de teste (rodar uma vez)
createdb tramita_test
DATABASE_URL_TEST=postgresql://user:pass@localhost:5432/tramita_test \
  pnpm --filter api prisma migrate deploy
```

### Executar
```bash
# Unitários + integração (API)
pnpm --filter api test

# Watch mode
pnpm --filter api test:watch

# Cobertura
pnpm --filter api test:coverage

# Frontend
pnpm --filter web test

# E2E (Playwright)
pnpm --filter web test:e2e
```

### Configuração Vitest (`apps/api/vitest.config.ts`)
```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],  // limpa banco antes de cada arquivo
    coverage: {
      provider: 'v8',
      include: ['src/modules/**', 'src/lib/**'],
      thresholds: { lines: 80, functions: 80 }
    }
  }
})
```

### Helper de teste (`apps/api/src/test/setup.ts`)
```typescript
import { prisma } from '@/lib/prisma'
import { buildApp } from '@/server'

export const app = buildApp()  // instância Fastify isolada

beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await prisma.$disconnect() })

// Limpa tabelas entre testes (ordem respeitando FK)
afterEach(async () => {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.taskHistory.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.column.deleteMany(),
    prisma.board.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ])
})
```

## Comandos

```bash
# Setup
pnpm install
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Migrations
# ⚠️  NUNCA use `pnpm --filter api prisma migrate dev` direto — o CLI do Prisma não
#     passa por app.ts, então DATABASE_URL não é carregado e o migrate falha silenciosamente
#     ou aplica no banco errado. Use sempre os scripts abaixo:

pnpm --filter api migrate:dev -- --name <nome>   # desenvolvimento (DATABASE_URL do .env raiz)
pnpm --filter api migrate:deploy                  # produção / CI
pnpm --filter api migrate:reset                   # reset completo (destrutivo — confirmar antes)

pnpm --filter api prisma db seed   # planos padrão + MASTER user + G2A como org

# Dev
pnpm --filter api dev     # porta 3000
pnpm --filter web dev     # porta 5173

# Docker completo
docker compose up -d
```

---

## Ordem de Implementação

Seguir **TASKS.md** fase por fase sem pular etapas.

**Critério de conclusão antes de avançar:**
- Fase 1: login retorna JWT válido com role correto
- Fase 2: Master consegue criar plano e ver lista de orgs
- Fase 3: cadastro de escritório cria customer + subscription no Asaas, webhook atualiza status
- Fase 4: CRUD completo de boards/colunas/tarefas funcional
- Fase 5: mensagem WhatsApp chega ao número de teste ao mover tarefa, template customizado é usado se existir
- Fase 6: drag-and-drop funcional, tela de templates com preview funcionando
- Fase 7: cliente faz login no portal e vê o board dele
- Fase 8: SSE atualiza board em tempo real, busca filtra corretamente
- Fase 9: `docker compose up` sobe tudo, domínios acessíveis

---

## Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Isolamento de tenant | middleware na camada app | Sem overhead de RLS, Prisma `where: { organizationId }` em todas as queries |
| Templates de mensagem | tabela `MessageTemplate` + fallback sistema | Escritório personaliza sem depender de redeploy |
| Billing | Asaas (recorrente via webhook) | Max já tem conta, API simples, boleto nativo |
| WhatsApp | MaximizeBot API | Documentação fornecida, token por org |
| Email | SMTP configurável por org | Escritório usa o próprio domínio de email |
| Auth cliente final | email + senha própria | Não tem conta Microsoft ou Google obrigatória |
| Domínio | `tramita.autohubs.com.br` único | Um TLS, zero CORS, branding AutoHubs, roteamento por role no frontend |
| SSE vs WebSocket | SSE | Unidirecional, sem lib extra, suficiente para o caso |