# Plano de Implementação — Tramita

## Fase 1 — Fundação ✅
### Testes da Fase 1
- [x] Configurar Vitest no monorepo (`vitest.config.ts` compartilhado)
- [x] Configurar banco de teste (`DATABASE_URL_TEST` + `prisma migrate deploy` no setup)
- [x] Helper `buildApp()` — sobe instância Fastify isolada para testes
- [x] `auth.service.test.ts` — hash de senha, geração e validação de JWT
- [x] `auth.routes.test.ts` — POST /auth/login (credenciais válidas, inválidas, role correto)
- [x] `auth.routes.test.ts` — POST /auth/refresh e POST /auth/logout
- [x] Inicializar monorepo pnpm: `apps/api` + `apps/web`
- [x] Setup Fastify v5 + TypeScript strict + Zod
- [x] Configurar Prisma v6 + PostgreSQL (migration inicial com schema completo)
- [x] Configurar Redis + BullMQ
- [x] Módulo `auth`: login unificado, JWT RS256, refresh, logout
- [x] Middleware `verifyOrg` — tenant isolation por organizationId
- [x] Middleware `checkSubscription` — bloqueia org suspensa
- [x] Middleware `checkPlanLimit` — valida limite de clientes
- [x] Rate limiting + CORS
- [x] `GET /health`
- [x] Seed: planos padrão (Starter/Pro/Enterprise) + usuário MASTER

## Fase 2 — Master AutoHubs ✅
### Testes da Fase 2
- [x] `plans.service.test.ts` — CRUD de planos, soft delete
- [x] `plans.routes.test.ts` — acesso bloqueado para role != MASTER
- [x] `organizations.routes.test.ts` — listagem e gestão pelo Master
- [x] CRUD de planos (`/master/plans`)
- [x] Listagem e gestão de escritórios (`/master/organizations`)
- [x] Dashboard de receita — MRR, total orgs ativas, churn
- [x] Painel React: `/master` com autenticação MASTER-only

## Fase 3 — Onboarding de Escritórios + Billing Asaas ✅
### Testes da Fase 3
- [x] `asaas.ts` — mock do client HTTP, testar criação de customer e subscription
- [x] `organizations.service.test.ts` — registro completo (org + admin + Asaas mockado)
- [x] `webhooks.routes.test.ts` — PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUSPENDED atualizam status corretamente
- [x] `checkSubscription.test.ts` — middleware bloqueia mutações em org suspensa
- [x] Client HTTP Asaas (`src/lib/asaas.ts`)
- [x] `POST /organizations/register` — cria org + admin + customer Asaas + subscription
- [x] `GET /organizations/plans` — listagem pública de planos
- [x] Webhook Asaas (`POST /webhooks/asaas`) — PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUSPENDED
- [x] Grace period automático (7 dias após PAYMENT_OVERDUE)
- [x] Painel `/org/subscription` — status atual + histórico + botão de troca de plano
- [x] Tela de cadastro público (landing → escolher plano → criar conta)

## Fase 4 — Core Kanban ✅
### Testes da Fase 4
- [x] `checkPlanLimit.test.ts` — bloqueia criação de cliente acima do limite do plano
- [x] `verifyOrg.test.ts` — bloqueia acesso a recurso de outra org
- [x] `tasks.service.test.ts` — move tarefa, atualiza position, grava TaskHistory
- [x] `tasks.routes.test.ts` — PATCH /tasks/:id/move (coluna isFinal dispara TASK_COMPLETED)
- [x] `comments.routes.test.ts` — authorType correto para USER e CLIENT
- [x] CRUD usuários internos (`/users`)
- [x] CRUD clientes finais (`/clients`) com validação de limite do plano
- [x] CRUD boards (`/boards`)
- [x] CRUD colunas + reorder (`/columns`)
- [x] CRUD tarefas + move + reorder (`/tasks`)
- [x] Histórico automático em cada mutação (`TaskHistory`)
- [x] CRUD comentários com `authorType` discriminado

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

## Fase 6 — Frontend Interno (Painel do Escritório) ✅
### Testes da Fase 6
- [x] `TaskCard.test.tsx` — renderiza prioridade, prazo vencido, badge correto
- [x] `TaskModal.test.tsx` — submit de edição chama PATCH com payload correto
- [x] `TemplateEditor.test.tsx` — preview renderiza variáveis em tempo real
- [x] `useBoard.test.ts` — hook retorna dados corretos, optimistic update reverte em erro
- [x] Setup React 19 + Vite + TailwindCSS v4 + shadcn/ui
- [x] Axios interceptors (refresh automático de token)
- [x] Tela de login única em `/login` — redireciona por role após autenticação:
  - `MASTER`      → `/master/dashboard`
  - `ORG_ADMIN`   → `/app/dashboard`
  - `ORG_MANAGER` → `/app/dashboard`
  - `ORG_MEMBER`  → `/app/board`
  - `CLIENT`      → `/portal/board`
- [x] Guard de rota: acesso fora do próprio role → redirect `/login`
- [x] Dashboard: boards por cliente, indicador de progresso, alertas de vencimento
- [x] Board Kanban com `@dnd-kit/core`
  - [x] Drag entre colunas com optimistic update
  - [x] Modal de tarefa: edição inline, prioridade
  - [x] Badge de prioridade colorido
  - [x] Destaque visual em tarefas vencidas
- [x] Tela de clientes: lista com contador de processos ativos
- [x] Tela de usuários: CRUD com roles
- [x] Tela de templates (`/app/settings/templates`)
  - [x] Seletor de evento + canal
  - [x] Editor de template com variáveis disponíveis listadas
  - [x] Botão "Prévia" — renderiza com dados fictícios em tempo real
  - [x] Botão "Testar" — envia mensagem real para número/email de teste
- [x] Tela de notificações: configurações + logs com status e mensagem enviada
- [x] Tela de assinatura: plano atual, próxima cobrança, histórico, troca de plano

## Fase 7 — Portal do Cliente Final
### Testes da Fase 7
- [ ] `portal.routes.test.ts` — CLIENT não acessa board de outra org
- [ ] `portal.routes.test.ts` — CLIENT não pode mover tarefas (403)
- [ ] `Comments.test.tsx` — submit registra authorType CLIENT corretamente
- [ ] Rota `/portal/*` com bundle separado (lazy load)
- [ ] Login do cliente (email + senha própria — sem conta Microsoft)
- [ ] Board do processo: colunas com cores, cards com prioridade e prazo
- [ ] Drawer de detalhes da tarefa
  - [ ] Campo de comentário (POST como CLIENT)
  - [ ] Lista de comentários com avatar e timestamp
  - [ ] Timeline de histórico de movimentações visível
- [ ] Barra de progresso: % concluído no board
- [ ] Seção de relatórios: download de PDFs mensais
- [ ] Tela de perfil: alterar senha, número WhatsApp

## Fase 8 — Recursos Avançados
### Testes da Fase 8
- [ ] `stream.test.ts` — evento emitido ao mover tarefa, heartbeat a cada 30s
- [ ] `search.routes.test.ts` — filtros combinados retornam apenas tarefas da org correta
- [ ] `attachments.service.test.ts` — mock B2 client, valida storageKey e signed URL
- [ ] `attachments.routes.test.ts` — rejeita arquivo acima de 20MB, tipo não permitido
- [ ] `reports.service.test.ts` — PDF gerado com dados do mês correto, cache Redis funciona
### 8a — Tempo Real (SSE)
- [ ] `GET /boards/:id/stream?token=<jwt>` — endpoint SSE
- [ ] Emitir eventos: `task:moved`, `task:created`, `task:updated`, `comment:added`, `heartbeat`
- [ ] Frontend interno: conectar ao SSE, atualizar via react-query sem reload
- [ ] Portal do cliente: mesma lógica — board atualiza ao vivo
- [ ] Reconexão automática com backoff

### 8b — Busca e Filtros
- [ ] `GET /boards/:id/tasks/search?q=&priority=&status=&assigneeId=&dueBefore=&dueAfter=`
- [ ] Frontend: barra de busca + filtros no board interno
- [ ] Portal: busca por título de tarefa

### 8c — Anexos (Backblaze B2)
- [ ] Backblaze B2 configurado via variáveis de ambiente
- [ ] `POST /tasks/:id/attachments` — upload multipart, max 20MB
- [ ] `GET /tasks/:id/attachments` — lista com signed URL (TTL 1h)
- [ ] `DELETE /tasks/:id/attachments/:attachmentId`
- [ ] Frontend: dropzone no modal da tarefa
- [ ] Portal: visualização e download de anexos

### 8d — Relatório PDF
- [ ] Puppeteer no docker-compose
- [ ] `GET /clients/:clientId/report?month=YYYY-MM` — gera PDF com cache Redis 1h
- [ ] Conteúdo: cabeçalho org, resumo executivo, tabela de tarefas, histórico do período
- [ ] Frontend interno: botão "Exportar relatório"
- [ ] Portal: seção de relatórios disponíveis para download

## Fase 9 — Infra e Deploy
### Testes da Fase 9
- [ ] Rodar suite completa no CI (GitHub Actions) a cada push
- [ ] `docker compose up` + `pnpm test` passam sem erros no ambiente limpo
- [ ] Cobertura mínima 80% em `apps/api/src/modules/*/` e `apps/api/src/lib/`
- [ ] Playwright E2E: login escritório → criar tarefa → mover → mensagem no log de notificações
- [ ] Playwright E2E: login cliente → ver board → comentar → receber notificação (mock MaximizeBot)
- [ ] `docker-compose.yml`: api, web, postgres, redis, puppeteer
- [ ] Dockerfiles multi-stage (api + web)
- [ ] `.env.example` completo
- [ ] Dokploy + Traefik
  - [ ] `tramita.autohubs.com.br` → web (todas as rotas: landing, /login, /master, /app, /portal)
  - [ ] `api.tramita.autohubs.com.br` → api Fastify
  - [ ] TLS automático (Let's Encrypt via Traefik)
- [ ] Healthchecks nos containers
- [ ] Script de seed: planos padrão, usuário MASTER, org G2A como primeiro cliente