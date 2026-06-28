# Tramita — SaaS de Acompanhamento de Processos

> Produto da AutoHubs — autohubs.com.br

## Visão Geral

SaaS B2B voltado a escritórios contábeis para gestão e transparência de processos de legalização (abertura, alteração, encerramento de empresas, registros em órgãos públicos). O escritório contrata um plano e oferece ao cliente final um portal para acompanhar o andamento de cada processo em tempo real.

---

## Hierarquia de Tenants

```
AutoHubs (Master)
    ├── Painel Admin — configura planos, onboarda escritórios, vê receita
    └── Escritório Contábil (Organization — tenant pagante)
            ├── Plano ativo com limite de clientes
            ├── Assinatura recorrente via Asaas
            ├── Usuários internos (Admin, Gerente, Colaborador)
            ├── Templates de mensagem personalizados (WhatsApp + Email)
            └── Clientes do escritório
                    └── Portal de acompanhamento de processos
```

---

## Stack Técnica

### Backend
- **Runtime:** Node.js 22 + TypeScript (strict)
- **Framework:** Fastify v5
- **ORM:** Prisma v6 + PostgreSQL 16
- **Filas:** BullMQ + Redis 7
- **Auth:** JWT RS256 — access 15min + refresh 7d (Redis)
- **WhatsApp:** MaximizeBot API (`POST /backend/api/messages/send`)
- **Email:** Nodemailer + SMTP (ou Resend)
- **Storage:** Backblaze B2 (S3-compatible)
- **PDF:** ~~Puppeteer~~ (removido em 2026-06-28 — Chromium inflava a imagem Docker; reimplementação futura com abordagem mais leve)
- **Billing:** Asaas API (assinaturas recorrentes + webhooks)
- **Validação:** Zod
- **Logs:** Pino

### Frontend
- **Framework:** React 19 + Vite
- **Estilo:** TailwindCSS v4 + shadcn/ui
- **DnD:** @dnd-kit/core + @dnd-kit/sortable
- **HTTP:** axios + @tanstack/react-query v5
- **Roteamento:** react-router-dom v7
- **Upload:** react-dropzone
- **Tempo real:** EventSource nativo (SSE)

### Testes
- **Runner:** Vitest (unitário + integração — API e frontend)
- **API integração:** Fastify `inject()` + banco PostgreSQL dedicado (`tramita_test`)
- **Frontend:** Vitest + @testing-library/react + jsdom
- **E2E:** Playwright
- **Cobertura:** Vitest coverage (c8) — mínimo 80% em `services/` e `lib/`

### Infra
- **Containerização:** Docker + Docker Compose
- **Deploy:** Dokploy + Traefik
- **Servidor:** Ubuntu 24.04
- **TLS:** Let's Encrypt via Traefik

---

## Estrutura de Pastas

```
tramita/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── master/           # Painel AutoHubs — planos, orgs, receita
│   │   │   │   ├── organizations/    # CRUD de escritórios
│   │   │   │   ├── plans/            # Planos e limites
│   │   │   │   ├── subscriptions/    # Assinaturas Asaas
│   │   │   │   ├── users/            # Usuários internos do escritório
│   │   │   │   ├── clients/          # Clientes finais do escritório
│   │   │   │   ├── boards/           # Boards de processos
│   │   │   │   ├── columns/          # Etapas do processo (colunas Kanban)
│   │   │   │   ├── tasks/            # Tarefas/processos
│   │   │   │   ├── comments/         # Comentários internos e do cliente
│   │   │   │   ├── attachments/      # Anexos (Backblaze B2)
│   │   │   │   ├── notifications/    # Config de notificações por org
│   │   │   │   ├── templates/        # Templates WhatsApp + Email por org
│   │   │   │   ├── reports/          # Relatórios PDF
│   │   │   │   └── stream/           # SSE — tempo real
│   │   │   ├── lib/
│   │   │   │   ├── prisma.ts
│   │   │   │   ├── redis.ts
│   │   │   │   ├── queue.ts
│   │   │   │   ├── maximizebot.ts    # Client HTTP MaximizeBot
│   │   │   │   ├── mailer.ts         # Nodemailer/Resend
│   │   │   │   ├── asaas.ts          # Client HTTP Asaas
│   │   │   │   ├── b2.ts               # Client Backblaze B2
│   │   │   │   ├── pdf.ts
│   │   │   │   └── sse.ts
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── cors.ts
│   │   │   │   └── rate-limit.ts
│   │   │   └── server.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── seed.ts
│   └── web/
│       └── src/
│           ├── pages/
│           │   ├── master/           # Painel AutoHubs
│           │   │   ├── Dashboard.tsx
│           │   │   ├── Organizations.tsx
│           │   │   ├── Plans.tsx
│           │   │   └── Revenue.tsx
│           │   ├── internal/         # Painel do escritório
│           │   │   ├── Dashboard.tsx
│           │   │   ├── Board.tsx
│           │   │   ├── Clients.tsx
│           │   │   ├── Users.tsx
│           │   │   ├── Templates.tsx # Configuração de mensagens
│           │   │   └── Settings.tsx
│           │   └── portal/           # Portal do cliente final
│           │       ├── Board.tsx
│           │       ├── Reports.tsx
│           │       └── Profile.tsx
│           ├── components/
│           │   ├── kanban/
│           │   └── ui/
│           └── hooks/
├── docker-compose.yml
├── .env.example
└── pnpm-workspace.yaml
```

---

## Perfis de Acesso

| Role            | Escopo         | Permissões                                                      |
|-----------------|----------------|-----------------------------------------------------------------|
| `MASTER`        | AutoHubs       | Tudo — planos, escritórios, billing, métricas globais          |
| `ORG_ADMIN`     | Escritório     | Configura usuários, clientes, templates, assinatura            |
| `ORG_MANAGER`   | Escritório     | CRUD tarefas, move cards, vê todos os clientes                 |
| `ORG_MEMBER`    | Escritório     | Atualiza apenas tarefas atribuídas a ele                       |
| `CLIENT`        | Portal         | Lê board próprio, comenta, baixa anexos e relatórios           |

---

## Modelo de Planos e Billing

### Planos (configurados pelo Master AutoHubs)
Cada plano define:
- Nome (ex: "Starter", "Pro", "Enterprise")
- Limite de clientes ativos
- Preço mensal (BRL)
- Features habilitadas (relatório PDF, SSE, anexos, etc.)

### Cobrança via Asaas
- Escritório se cadastra → AutoHubs cria customer no Asaas
- Escolhe plano → AutoHubs cria subscription recorrente no Asaas
- Asaas cobra automaticamente (boleto ou cartão)
- Webhook Asaas → API Tramita atualiza status da assinatura
- Assinatura vencida → escritório entra em modo restrito (read-only) após 7 dias de grace period

### Controle de Limite
- Middleware `checkPlanLimit` em `POST /clients` valida `clientsCount < plan.maxClients`
- Dashboard do escritório exibe uso atual vs limite do plano

---

## Templates de Mensagem

Cada escritório configura seus próprios templates para cada evento. As variáveis disponíveis são interpoladas no momento do envio.

### Variáveis disponíveis por evento

| Variável          | Descrição                              |
|-------------------|----------------------------------------|
| `{{clientName}}`  | Nome do cliente final                  |
| `{{orgName}}`     | Nome do escritório contábil            |
| `{{taskTitle}}`   | Título da tarefa/processo              |
| `{{fromColumn}}`  | Etapa anterior                         |
| `{{toColumn}}`    | Nova etapa                             |
| `{{dueDate}}`     | Data de vencimento formatada           |
| `{{portalUrl}}`   | Link direto para o portal do cliente   |
| `{{commentText}}` | Texto do comentário (quando aplicável) |

### Template padrão (fallback se escritório não configurar)
```
task.moved (WhatsApp):
"📋 *{{orgName}}*
Olá, {{clientName}}! Seu processo *{{taskTitle}}* avançou para a etapa *{{toColumn}}*.
Acompanhe: {{portalUrl}}"

task.completed (WhatsApp):
"✅ *{{orgName}}*
Olá, {{clientName}}! Seu processo *{{taskTitle}}* foi concluído com sucesso!"

task.comment_added (WhatsApp):
"💬 *{{orgName}}*
Novo comentário no processo *{{taskTitle}}*.
Acesse o portal para responder: {{portalUrl}}"

task.due_date_approaching (WhatsApp):
"⏰ *{{orgName}}*
O processo *{{taskTitle}}* vence em 24h ({{dueDate}}).
Acesse: {{portalUrl}}"
```

---

## Fluxo de Notificações (MaximizeBot)

```
Evento (tarefa movida, comentada, vencimento)
    ↓
BullMQ Queue: "notification-queue"
    ↓
Worker busca:
  - NotificationConfig do escritório (evento habilitado?)
  - Template personalizado (ou fallback padrão)
  - Interpola variáveis no template
    ↓
POST https://app.maximizebot.com.br/backend/api/messages/send
  { number, body, saveOnTicket: true }
    ↓
Log salvo em NotificationLog (SENT | FAILED)
    ↓
Retry: 3x com backoff exponencial (1s → 5s → 30s)
```

---

## Fluxo de Billing (Asaas)

```
Escritório se cadastra no Tramita
    ↓
API cria Customer no Asaas (POST /customers)
    ↓
Escritório escolhe plano
    ↓
API cria Subscription no Asaas (POST /subscriptions)
  { customer, billingType, value, cycle: MONTHLY }
    ↓
Asaas processa cobrança automaticamente
    ↓
Webhook POST /webhooks/asaas
  PAYMENT_CONFIRMED → ativa/renova assinatura
  PAYMENT_OVERDUE   → inicia grace period (7 dias)
  PAYMENT_DELETED   → suspende escritório
```

---

## Fluxo SSE — Tempo Real

```
Usuário abre board
    ↓
GET /boards/:id/stream?token=<jwt>
    ↓
Conexão SSE mantida aberta
    ↓
Qualquer mutação na API emite evento para todos conectados no board
    ↓
Frontend: react-query atualiza cache sem reload
```

Para múltiplas instâncias: Redis Pub/Sub como broker de eventos SSE.

---

## Domínio

Produto acessado em domínio único: **`tramita.autohubs.com.br`**
Não há white-label — identidade visual única do Tramita/AutoHubs.

Todas as rotas vivem no mesmo domínio e bundle. O roteamento pós-login é feito pelo frontend com base no `role` do JWT — o usuário nunca precisa conhecer URLs internas.

| URL                                        | Destino                                        |
|--------------------------------------------|------------------------------------------------|
| `tramita.autohubs.com.br/`                 | Landing page + cadastro público                |
| `tramita.autohubs.com.br/login`            | Login único (todos os perfis)                  |
| `tramita.autohubs.com.br/master`           | Painel AutoHubs — `role: MASTER`               |
| `tramita.autohubs.com.br/app`              | Painel do escritório — `role: ORG_*`           |
| `tramita.autohubs.com.br/portal`           | Portal do cliente final — `role: CLIENT`       |

### Lógica de redirect pós-login

```
POST /auth/login → JWT com role
    ↓
Frontend lê role do token
    ↓
MASTER      → /master/dashboard
ORG_ADMIN   → /app/dashboard
ORG_MANAGER → /app/dashboard
ORG_MEMBER  → /app/board (board padrão da org)
CLIENT      → /portal/board
```

Qualquer tentativa de acessar rota fora do próprio role retorna redirect para `/login`.