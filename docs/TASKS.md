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

## Fase 2 — Master AutoHubs
### Testes da Fase 2
- [ ] `plans.service.test.ts` — CRUD de planos, soft delete
- [ ] `plans.routes.test.ts` — acesso bloqueado para role != MASTER
- [ ] `organizations.routes.test.ts` — listagem e gestão pelo Master
- [ ] CRUD de planos (`/master/plans`)
- [ ] Listagem e gestão de escritórios (`/master/organizations`)
- [ ] Dashboard de receita — MRR, total orgs ativas, churn
- [ ] Painel React: `/master` com autenticação MASTER-only

## Fase 3 — Onboarding de Escritórios + Billing Asaas
### Testes da Fase 3
- [ ] `asaas.ts` — mock do client HTTP, testar criação de customer e subscription
- [ ] `organizations.service.test.ts` — registro completo (org + admin + Asaas mockado)
- [ ] `webhooks.routes.test.ts` — PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUSPENDED atualizam status corretamente
- [ ] `checkSubscription.test.ts` — middleware bloqueia mutações em org suspensa
- [ ] Client HTTP Asaas (`src/lib/asaas.ts`)
- [ ] `POST /organizations/register` — cria org + admin + customer Asaas + subscription
- [ ] `GET /organizations/plans` — listagem pública de planos
- [ ] Webhook Asaas (`POST /webhooks/asaas`) — PAYMENT_CONFIRMED, PAYMENT_OVERDUE, SUSPENDED
- [ ] Grace period automático (7 dias após PAYMENT_OVERDUE)
- [ ] Painel `/org/subscription` — status atual + histórico + botão de troca de plano
- [ ] Tela de cadastro público (landing → escolher plano → criar conta)

## Fase 4 — Core Kanban
### Testes da Fase 4
- [ ] `checkPlanLimit.test.ts` — bloqueia criação de cliente acima do limite do plano
- [ ] `verifyOrg.test.ts` — bloqueia acesso a recurso de outra org
- [ ] `tasks.service.test.ts` — move tarefa, atualiza position, grava TaskHistory
- [ ] `tasks.routes.test.ts` — PATCH /tasks/:id/move (coluna isFinal dispara TASK_COMPLETED)
- [ ] `comments.routes.test.ts` — authorType correto para USER e CLIENT
- [ ] CRUD usuários internos (`/users`)
- [ ] CRUD clientes finais (`/clients`) com validação de limite do plano
- [ ] CRUD boards (`/boards`)
- [ ] CRUD colunas + reorder (`/columns`)
- [ ] CRUD tarefas + move + reorder (`/tasks`)
- [ ] Histórico automático em cada mutação (`TaskHistory`)
- [ ] CRUD comentários com `authorType` discriminado

## Fase 5 — Templates e Notificações
### Testes da Fase 5
- [ ] `template.test.ts` — interpolação de todas as variáveis, variável ausente retorna string vazia
- [ ] `template.test.ts` — fallback para template padrão quando org não tem customizado
- [ ] `maximizebot.test.ts` — mock axios, valida payload enviado (number, body, token)
- [ ] `mailer.test.ts` — mock nodemailer, valida subject e body renderizados
- [ ] `notification-worker.test.ts` — evento desabilitado não envia, log FAILED em erro de envio
- [ ] `templates.routes.test.ts` — POST /notifications/templates/preview renderiza corretamente
- [ ] Client HTTP MaximizeBot (`src/lib/maximizebot.ts`)
- [ ] Nodemailer/Resend client (`src/lib/mailer.ts`)
- [ ] CRUD `NotificationConfig` por org
- [ ] CRUD `MessageTemplate` por org — WhatsApp + Email por evento
- [ ] Endpoint `POST /notifications/templates/preview` — renderiza prévia com vars fictícias
- [ ] Endpoints de teste: `test-whatsapp` e `test-email`
- [ ] BullMQ worker `notification-queue`
  - [ ] Interpola variáveis no template ({{clientName}}, {{taskTitle}}, etc.)
  - [ ] Busca template customizado ou fallback padrão do sistema
  - [ ] Envia via MaximizeBot (WhatsApp)
  - [ ] Envia via Nodemailer (Email)
  - [ ] Salva log em `NotificationLog`
  - [ ] Retry 3x com backoff exponencial
- [ ] Disparar `TASK_MOVED` ao mover tarefa
- [ ] Disparar `TASK_COMPLETED` ao entrar em coluna `isFinal`
- [ ] Disparar `TASK_COMMENT_ADDED` ao comentar
- [ ] Cron BullMQ: verificar `dueDate` em 24h → `TASK_DUE_DATE_APPROACHING`
- [ ] Painel de logs de notificação no frontend interno

## Fase 6 — Frontend Interno (Painel do Escritório)
### Testes da Fase 6
- [ ] `TaskCard.test.tsx` — renderiza prioridade, prazo vencido, badge correto
- [ ] `TaskModal.test.tsx` — submit de edição chama PATCH com payload correto
- [ ] `TemplateEditor.test.tsx` — preview renderiza variáveis em tempo real
- [ ] `useBoard.test.ts` — hook retorna dados corretos, optimistic update reverte em erro
- [ ] Setup React 19 + Vite + TailwindCSS v4 + shadcn/ui
- [ ] Axios interceptors (refresh automático de token)
- [ ] Tela de login única em `/login` — redireciona por role após autenticação:
  - `MASTER`      → `/master/dashboard`
  - `ORG_ADMIN`   → `/app/dashboard`
  - `ORG_MANAGER` → `/app/dashboard`
  - `ORG_MEMBER`  → `/app/board`
  - `CLIENT`      → `/portal/board`
- [ ] Guard de rota: acesso fora do próprio role → redirect `/login`
- [ ] Dashboard: boards por cliente, indicador de progresso, alertas de vencimento
- [ ] Board Kanban com `@dnd-kit/core`
  - [ ] Drag entre colunas com optimistic update
  - [ ] Modal de tarefa: edição inline, assignee, prioridade, prazo, tags
  - [ ] Badge de prioridade colorido
  - [ ] Destaque visual em tarefas vencidas
- [ ] Tela de clientes: lista com contador de processos ativos
- [ ] Tela de usuários: CRUD com roles
- [ ] Tela de templates (`/app/settings/templates`)
  - [ ] Seletor de evento + canal
  - [ ] Editor de template com variáveis disponíveis listadas
  - [ ] Botão "Prévia" — renderiza com dados fictícios em tempo real
  - [ ] Botão "Testar" — envia mensagem real para número/email de teste
- [ ] Tela de notificações: configurações + logs com status e mensagem enviada
- [ ] Tela de assinatura: plano atual, próxima cobrança, histórico, troca de plano

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