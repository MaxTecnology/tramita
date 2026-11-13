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
- [x] Seed: org AutoHubs (plano interno oculto, só pra satisfazer o vínculo obrigatório) + usuário MASTER (`MASTER_EMAIL`/`MASTER_PASSWORD` configuráveis) — planos de venda reais e a primeira org cliente são cadastrados depois, pelo próprio painel

## Fase 2 — Master AutoHubs ✅
### Testes da Fase 2
- [x] `plans.service.test.ts` — CRUD de planos, soft delete
- [x] `plans.routes.test.ts` — acesso bloqueado para role != MASTER
- [x] `organizations.routes.test.ts` — listagem e gestão pelo Master
- [x] CRUD de planos (`/master/plans`)
- [x] Listagem e gestão de escritórios (`/master/organizations`)
- [x] Cadastro manual de escritório pelo Master (`POST /master/organizations`) — sem depender do `/organizations/register` público nem obrigatoriamente da Asaas (checkbox opcional); senha do ORG_ADMIN gerada pelo servidor e mostrada uma vez
- [x] Tela de detalhe da organização (`/master/organizations/:id`) com lista de usuários
- [x] Reset de senha: Master redefine qualquer usuário; ORG_ADMIN redefine `ORG_MANAGER`/`ORG_MEMBER` da própria equipe (`POST /users/:id/reset-password`)
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

### Ajustes de roles e workflow (pós-fase 4)
- [x] `responsibleUserId` no Board — colaborador vê apenas seus processos
- [x] `POST /boards` aberto para ORG_MEMBER — cria com responsável automático e 3 colunas padrão
- [x] `GET /clients` aberto para ORG_MEMBER — para modal de criação de board
- [x] `POST /boards/:id/columns` aberto para ORG_MEMBER
- [x] Dashboard: botão "Novo Processo" + modal com 3 colunas padrão automáticas

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
- [x] Disparar `TASK_COMMENT_ADDED` ao comentar ← fix aplicado: `comments.service.ts` agora chama `enqueueNotification` com `taskTitle`, `commentText` e `commentAuthorName`
- [x] Cron BullMQ: verificar `dueDate` em 24h → `TASK_DUE_DATE_APPROACHING`
- [x] Painel de logs de notificação no frontend interno ← endpoint GET /notifications/logs entregue; painel visual na Fase 6

### Pré-requisitos para WhatsApp funcionar localmente
- Worker deve rodar em processo separado: `pnpm --filter api worker`
- Org deve ter `NotificationConfig` com `whatsappEnabled: true` e `maximizebotToken` preenchido (em `/app/settings/notifications`)
- Cliente deve ter número `whatsapp` cadastrado (em `/app/clients`)
- Eventos que disparam mensagem: tarefa movida, tarefa concluída, comentário adicionado, prazo se aproximando

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

## Fase 7 — Portal do Cliente Final ✅
### Testes da Fase 7
- [x] `portal.routes.test.ts` — CLIENT não acessa board de outra org
- [x] `portal.routes.test.ts` — CLIENT não pode mover tarefas (403)
- [x] `Comments.test.tsx` — submit registra authorType CLIENT corretamente
- [x] Rota `/portal/*` com bundle separado (lazy load)
- [x] Login do cliente (email + senha própria — sem conta Microsoft)
- [x] Board do processo: colunas com cores, cards com prioridade e prazo
- [x] Drawer de detalhes da tarefa
  - [x] Campo de comentário (POST como CLIENT)
  - [x] Lista de comentários com avatar e timestamp
  - [x] Timeline de histórico de movimentações visível
- [x] Barra de progresso: % concluído no board
- [x] Seção de relatórios: download de PDFs mensais
- [x] Tela de perfil: alterar senha, telefone

## Fase 8 — Recursos Avançados ✅
### Testes da Fase 8
- [x] `stream.test.ts` — evento emitido ao mover tarefa, heartbeat a cada 30s
- [x] `search.routes.test.ts` — filtros combinados retornam apenas tarefas da org correta
- [x] `attachments.service.test.ts` — mock B2 client, valida storageKey e signed URL
- [x] `attachments.routes.test.ts` — rejeita arquivo acima de 20MB, tipo não permitido
- [x] `reports.service.test.ts` — PDF gerado com dados do mês correto, cache Redis funciona
### 8a — Tempo Real (SSE) ✅
- [x] `stream.test.ts` — evento emitido ao mover tarefa, heartbeat (endpoint auth)
- [x] `GET /boards/:id/stream?ticket=<ticket>` — endpoint SSE (ticket de uso único via `POST /stream/ticket`, desde 2026-11-12; antes era `?token=<jwt>`)
- [x] Emitir eventos: `task:moved`, `task:created`, `task:updated`, `comment:added`
- [x] Frontend interno: conectar ao SSE, atualizar via react-query sem reload
- [x] Portal do cliente: mesma lógica — board atualiza ao vivo
- [x] Reconexão automática com backoff

### 8b — Busca e Filtros ✅
- [x] `GET /boards/:id/tasks/search?q=&priority=&status=&assigneeId=&dueBefore=&dueAfter=`
- [x] Frontend: barra de busca + filtros no board interno
- [x] Portal: busca por título de tarefa

### 8c — Anexos (Backblaze B2) ✅
- [x] Backblaze B2 configurado via variáveis de ambiente
- [x] `POST /tasks/:id/attachments` — upload multipart, max 20MB
- [x] `GET /tasks/:id/attachments` — lista com signed URL (TTL 1h)
- [x] `DELETE /tasks/:id/attachments/:attachmentId`
- [x] Frontend: dropzone no modal da tarefa
- [x] Portal: visualização e download de anexos

### 8d — Relatório PDF ✅
- [x] `GET /clients/:clientId/report?month=YYYY-MM` — gera PDF com cache Redis 1h
- [x] Conteúdo: cabeçalho org, resumo executivo, tabela de tarefas, histórico do período
- [x] Frontend interno: botão "Exportar relatório"
- [x] Portal: seção de relatórios disponíveis para download

**Nota (2026-06-28):** feature removida — o Chromium necessário pro Puppeteer
inflava demais a imagem Docker da API (~1.4GB, majoritariamente Chromium e
libs de sistema). Reimplementação planejada com abordagem mais leve (sem
browser headless completo), em sessão futura.

## Fase 9 — Infra e Deploy
### Testes da Fase 9
- [x] Rodar suite completa no CI (GitHub Actions) a cada push — `.github/workflows/ci.yml` (jobs `test` e `e2e`) validado rodando de verdade no GitHub após push na `main`: ambos os jobs verdes (run `35518450806`), incluindo os 8 testes Playwright do job `e2e`
- [x] `docker compose up` + `pnpm test` passam sem erros no ambiente limpo — verificado localmente (API 197/197 + Web 11/11 passando) e no CI
- [x] Cobertura mínima 80% em `apps/api/src/modules/*/` e `apps/api/src/lib/` — 82.76% linhas / 81.25% funções (248 testes), `pnpm --filter api test:coverage` passa com exit 0; CI voltou a rodar `test:coverage` com enforcement
- [x] Playwright E2E: login escritório → dashboard/lista de processos → abrir board → editar tarefa — `apps/web/e2e/flows/org-board.spec.ts`, 4/4 testes passando de forma estável (5 execuções locais consecutivas + verde no CI). Specs corrigidos nesta sessão: rota de listagem mudou de `/app/dashboard` para `/app/processes`; seletor de link ambíguo por causa do layout responsivo duplicado (mobile/desktop); edição de título migrou de modal para drawer com campo inline (sem botão "Salvar" dedicado). Cobertura real é login → lista → board → editar tarefa; mover tarefa entre colunas e verificar o log de notificações **não** estão cobertos por essas specs (`grep -ri "notifica\|worker" apps/web/e2e` não retorna nada) — ver `docs/tech-debt.md` também para uma inconsistência de UI encontrada no processo (`TaskDrawer` não atualiza o próprio heading após salvar, embora a mutação persista)
- [x] Playwright E2E: login cliente → ver board → comentar — `apps/web/e2e/flows/portal-client.spec.ts`, 4/4 testes passando (nenhuma correção necessária, specs já batiam com a UI atual). Cobertura real é login/board/comentário; verificação de notificação (mock MaximizeBot) não é exercida pelos specs
- [x] `docker-compose.prod.yml`: api, web, worker (postgres/redis já existem no Dokploy)
- [x] Dockerfiles multi-stage (api + web)
- [x] `.env.example` completo
- [x] Dokploy + Traefik
  - [x] `tramita.autohubs.com.br` → web (todas as rotas: landing, /login, /master, /app, /portal)
  - [x] `tramitaapi.autohubs.com.br` → api Fastify
  - [x] TLS automático (Let's Encrypt via Traefik, gerenciado pelo Dokploy)
- [x] Healthchecks nos containers
- [x] Script de seed: planos padrão (`prisma/seed.ts`, placeholder Starter/Pro/Enterprise — editar valores reais pelo painel Master) + usuário MASTER, verificado idempotente rodando duas vezes contra o banco de teste. Org G2A como primeiro cliente fica isolada em `prisma/e2e-seed.ts` (self-contained via upsert, só roda em banco de teste/E2E, nunca em produção)

## Fase 10 — Evolução de Produto (decidido em sessão de brainstorming, 2026-09-20)

Visão do usuário: crescer o Tramita se inspirando no **Nibo Contador Plus** (automação de documentos, portal do cliente, integração financeira) e no **Gestta Processos** (gestão de tarefas/workflow, produtividade, SLA), mas com identidade própria — não uma cópia de nenhum dos dois. Escopo grande demais pra uma spec só — decompõe em sub-projetos independentes, cada um com seu próprio ciclo spec → plano → implementação.

### Fora do radar por enquanto (decisão explícita do usuário — não construir agora)
- Monitoramento de CND (certidões negativas — integração recorrente com Receita e outros órgãos)
- Recálculo de guias pelo cliente (DAS/DARF) — depende de integração com sistema de cálculo fiscal (Domínio ou API própria), provavelmente fora de alcance sem parceria/API oficial
- Assinatura digital (integração com provedor terceiro tipo Clicksign/D4Sign)
- Importação financeira (integração bancária/open finance — escopo grande e regulatório)

### Confirmado como evolução do que já existe (não é greenfield)
- "Ordem de Serviço" (conceito do Gestta) = evolução do módulo **Solicitações** (`Requests`, já implementado na Fase 6/7) — quando essa frente entrar em brainstorming, começar pelo que já existe, não do zero.

### Roadmap de sub-projetos ativos (ordem de prioridade ainda em aberto, exceto o item 1)
1. [x] **Redesign visual premium — fundação** (concluído em 2026-09-20) — tokens de design (paleta petróleo/âmbar/teal/danger, dark mode nativo via `prefers-color-scheme`, fonte Inter), aplicado a `AppLayout` (com o menu reagrupado sob "Configurações") + `DashboardMetrics` + `Processes` + `Board` + componentes base `shadcn/ui`. Ver `docs/superpowers/specs/2026-09-20-visual-redesign-foundation-design.md` e `docs/superpowers/plans/2026-09-20-visual-redesign-foundation.md`. Pendente pra fases futuras do redesign: Portal do cliente, Clientes/Usuários, Master, telas de Configurações, `TaskCard.tsx` (ver `docs/tech-debt.md`).
2. Tarefas recorrentes (semanal/mensal/trimestral/anual) + Calendário mensal — pedido original do usuário que iniciou essa sessão de brainstorming. Escopo grande demais pra uma spec só, decomposto em sub-fases durante o brainstorming (cada uma com spec/plano próprios):
   - [x] **2a. Departamentos + responsabilidade por cliente** (concluído em 2026-09-20) — fundação organizacional: `Department` (configurável por organização), `ClientAssignment` por cliente+departamento (exatamente um responsável por par, antes era genérico), `departmentId` opcional em `Task`/`Request`, roteamento de notificação por departamento em comentário de cliente e Solicitação (com fallback pro comportamento antigo quando não há departamento), tela de CRUD de Departamentos sob Configurações, seleção de departamento no `TaskDrawer` e no formulário de nova Solicitação do portal. Ver `docs/superpowers/specs/2026-09-20-departments-responsibility-design.md` e `docs/superpowers/plans/2026-09-20-departments-responsibility.md`.
   - [x] **2b. Motor de recorrência + status expandido** (concluído em 2026-09-21) — `RecurringTaskTemplate` + `RecurringTaskAssignment` por cliente/board/coluna, geração idempotente de `Task` (cron diário + geração manual) com `RecurringGenerationLog` por competência, status expandido (Aberto/Concluído/Desconsiderado/Com Impedimento) recalculado automaticamente a partir de checklist de documentos a pedir/entregar (`TaskDocumentRequirement`/`TaskDeliverable`), upload e revisão de documento via B2, tela de CRUD de Tarefas Recorrentes (vínculos por cliente + log de geração) e checklist de documentos no `TaskDrawer`. Ver `docs/superpowers/specs/2026-09-20-recurring-tasks-design.md` e `docs/superpowers/plans/2026-09-20-recurring-tasks.md`.
   - [x] 2c. Visão em lista cross-cliente com filtros (concluído sem trabalho novo, 2026-10-05) — já
     satisfeito pela tela "Tarefas" existente (filtro por `recurringTemplateId` cruza clientes
     diferentes desde o redesenho de Kanban, item 9).
   - [x] 2d. Calendário mensal (concluído em 2026-10-05) — terceiro modo na tela "Tarefas"
     (`view: 'calendar'`), mesmos filtros e mesma query `GET /tasks` de Lista/Kanban. Posiciona
     tarefa por `targetDate` (fallback `dueDate`), grade de semanas completas, até 2 tarefas
     visíveis por dia + popover "+N mais". Ver `docs/superpowers/specs/2026-10-05-calendario-impedimento-portal-design.md`.
   - [x] 2e. Sinalização de "impedimento" no portal do cliente (concluído em 2026-10-05) — selo de
     status no card do Kanban do portal (`portal/Board.tsx`), e notificação `TASK_BLOCKED` (toggle
     `taskBlocked` em Configurações, mensagem customizável em Templates) quando uma tarefa do
     cliente entra em impedimento — dispara de um ponto único (`notifyIfBlocked`) cobrindo os três
     caminhos que escrevem `Task.status`. Ver mesma spec/plano do item 2d.
   - [x] 2f. Vencimento como âncora + gestão em lote + correção pós-geração (concluído em
     2026-10-07/08) — corrige um defeito conceitual grave do motor de 2b: o cálculo de datas
     tratava competência como âncora e derivava vencimento dela, o que podia gerar tarefa já
     vencida no dia em que nascia (achado em uso real de produção). Modelo invertido: vencimento
     é a âncora (`competenceMonthOffset`), e TRIMESTRAL/ANUAL ganham `dueMonthAnchor` configurável
     (grupo de meses / mês literal, inspirado no Gestta) em vez de ficarem travados em
     Jan/Abr/Jul/Out e janeiro. Substitui o popup de vínculos por `RecurringTemplateManage.tsx`
     (busca, seleção múltipla, geração em lote, banner de falhas persistente) + console global
     `RecurringGenerationConsole.tsx` + hub `SettingsHub.tsx` (sidebar colapsada num só item com
     badge de falhas). Vencimento/meta de tarefa recorrente travados contra edição direta (todo
     mundo, sem exceção — `tasks.service.ts`); correção pós-geração via `regenerateTask`/
     `regenerateBulkForTemplate` (apaga + gera de novo com a config atual do template, só permitido
     sem nenhuma movimentação real). `MonthYearPicker` substitui `<input type="month">` (sem
     suporte no Firefox). Ver `docs/superpowers/specs/2026-10-06-recurring-generation-redesign-design.md`
     e `docs/superpowers/plans/2026-10-06-recurring-generation-redesign.md`.
3. [x] **SLA e alertas de prazo (visual/sonoro)** (concluído em 2026-10-08) — nível de alerta
   (`TARGET_WARNING`/`DUE_CRITICAL`) é derivado, nunca armazenado (`computeSlaLevel`, espelhado
   backend/frontend), a partir de `targetDate`/`dueDate` + thresholds configuráveis por org
   (`slaTargetWarningDays`/`slaDueCriticalDays`). Badge visual no `TaskCard`; push em tempo real
   (toast + Web Notification + som) só pra boards tipo OS, via polling leve (sem SSE/Service
   Worker novo) com dedup por `sessionStorage`. Som customizável por usuário
   (`UserSlaPreference`: escolha + volume por nível) e som próprio por organização (upload B2,
   `ORG_ADMIN`). Substitui integralmente o antigo `duedate.cron.ts`/`TASK_DUE_DATE_APPROACHING`
   (cron horário sem dedup, repetia a mesma notificação até 24x) por `sla-digest.cron.ts`: 1 job
   diário (8h) agregando OS + Recorrente num resumo único por email/WhatsApp. Ver
   `docs/superpowers/specs/2026-10-08-sla-alertas-prazo-design.md` e
   `docs/superpowers/plans/2026-10-08-sla-alertas-prazo-plan.md`. Revisão final (Opus) encontrou
   1 crítico (vazamento de dado pra usuário desativado/org suspensa) e 6 altos (regressão de
   WhatsApp em eventos pré-existentes, push que não reagia à passagem do tempo, avalanche de
   alertas pra admin, entre outros) — todos corrigidos, mais 8 minors de robustez/segurança
   (magic bytes no upload de som, race condition em preferência de usuário, etc). 3 arquivos de
   som padrão do sistema fornecidos pelo usuário em 2026-10-08.
4. [x] **Métricas de produtividade por usuário/departamento** (concluído em 2026-10-08) —
   `Task.completedAt` + histórico `status_changed` unificado nos 3 pontos de escrita (editar
   status direto, mover no Kanban, recálculo automático de checklist) como base confiável pras
   métricas de tempo. 5 frentes: volume, cumprimento de prazo (meta e vencimento, calculados
   separadamente — meta só conta tarefas que tinham `targetDate`), tempo médio de conclusão +
   indicador de fechamento tardio (threshold configurável por org), carga atual, e impedimento
   (soma de todos os períodos `BLOCKED`, incluindo o período ainda em aberto). Tudo distinguindo
   OS de Recorrente. Acesso: gestão (`ORG_ADMIN`/`ORG_MANAGER`) vê tudo com filtros de
   departamento/pessoa; `ORG_MEMBER` vê só o próprio desempenho, trava aplicada no backend (não
   só escondendo o seletor na UI). Abas novas "Visão geral"/"Produtividade" no Dashboard
   existente. Ver `docs/superpowers/specs/2026-10-08-metricas-produtividade-design.md` e
   `docs/superpowers/plans/2026-10-08-metricas-produtividade-plan.md`.
5. [x] **Evolução de Solicitações → Ordem de Serviço** (concluído em 2026-10-10) —
   fecha os 4 gaps do fluxo Solicitação→OS: link pro processo após aprovação tanto no admin
   (`/app/board/:boardId`) quanto no portal (`/portal/board/:boardId`), via campo `boardId`
   agora exposto em `GET /requests`/`GET /requests/:id`/`GET /portal/requests`; status de
   triagem `NEEDS_INFO` (`POST /requests/:id/needs-info`, ORG_ADMIN/ORG_MANAGER, comentário
   obrigatório) com reversão automática pra `PENDING` quando o cliente comenta (comentário da
   equipe não reverte); thread de comentários na própria Request via novo modelo
   `RequestComment` + módulo `request-comments` (espelho de `Comment`/`comments`, mesmo padrão
   de soft-delete e visibilidade); cancelamento pós-aprovação pelo escritório
   (`POST /requests/:id/cancel`, motivo obrigatório, Task associada vira `DISREGARDED`), travado
   por zero-atividade (mesma regra de `regenerateTask`: sem histórico além de `created`, sem
   comentário, sem anexo na Task). `approveRequest`/`rejectRequest`/cancelamento do cliente
   agora também aceitam `NEEDS_INFO` como status de origem, pra não travar a triagem. Componente
   `Comments` do frontend generalizado (`entityType: 'task' | 'request'`) em vez de duplicado.
   3 novos eventos de notificação (`REQUEST_NEEDS_INFO`, `REQUEST_COMMENT_ADDED`,
   `REQUEST_CANCELLED`) nivelados nos 6 pontos de toque padrão (enum, config, flag map,
   templates default, UI de Notificações, UI de Templates). Ver
   `docs/superpowers/specs/2026-10-08-evolucao-solicitacoes-os-design.md` e
   `docs/superpowers/plans/2026-10-08-evolucao-solicitacoes-os-plan.md`.
6. [x] **Automação de documentos fiscais — Plano A: pipeline central concluído** (concluído em 2026-10-15) —
   motor de leitura portado da POC (`apps/api/src/modules/document-reader/engine/`), determinístico
   (âncoras + zonas + validadores de CNPJ/CPF/data/competência), sem IA no caminho principal.
   Pipeline dividido em extração pura (`extrairEInterpretar`, sem banco) e decisão (`decidir`, recebe
   um `Base` já resolvido) — service layer (`document-reader.service.ts`) faz a resolução assíncrona
   de cliente/tarefa real entre os dois. Dois níveis de modelo: `ObligationType`/`DocumentModel`
   (renomeado de `TaxObligationType` em 2026-10-16 — o robô não é fiscal-específico, serve
   qualquer departamento/obrigação que gere documento pra anexar numa tarefa, seguindo a mesma
   ideia dos "robôs personalizados" do Nibo)
   com `organizationId` nulo = global (AutoHubs, seed de 4 modelos: DARF/IRPJ-CSLL, DAS, PGDAS-D
   recibo, PGDAS-D declaração) ou preenchido = privado do escritório — resolve o risco de um
   cadastro errado de um escritório vazar pra todos. **Modo sombra em v1**: o motor sempre roda e
   sempre grava uma sugestão (`taskId`/`confidence`/`documentModelId`) em `ReceivedDocument`, mas
   status nunca vira `ATTACHED` sozinho — só fica `ATTACHED` quando um humano confirma na fila de
   revisão (`confirmarSugestao`/`trocarTarefa`, que chamam o `createAttachment` já existente).
   Ingestão com dedupe por hash SHA-256 por organização (`P2002` tratado como 409, não 500),
   fila BullMQ (`document-reader-queue`, 3 tentativas com backoff exponencial) consumida por worker
   dedicado. PDF corrompido/ilegível nunca trava em `PENDING` pra sempre — vira `NOT_IDENTIFIED`
   com o motivo registrado em `extractedFields._erro`. Cliente ganhou `cei`/`caepf`/
   `inscricaoEstadual` — o casamento por CNPJ tenta também CPF/CEI/CAEPF/IE, nessa ordem.
   `numero_documento` extraído vira sinal não-bloqueante de possível duplicata
   (`extractedFields._possivelDuplicataDe`) entre documentos da mesma org — fica a critério do
   revisor. Expurgo LGPD: documentos `REJECTED` com mais de 30 dias (cron diário às 3h BRT) têm o
   arquivo apagado do B2 e `extractedFields` zerado; `PENDING`/`NOT_IDENTIFIED` nunca expurgam
   (trabalho em aberto). Métricas por modelo (`obterMetricas`) contam só decisão humana
   (confirmado/trocado/rejeitado), nunca a sugestão automática. Frontend: tela "Fila de revisão"
   (`/app/document-reader`, link no menu pra `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER`) — upload de
   PDF, lista de pendentes com campos extraídos e confiança, ações confirmar/trocar
   tarefa/rejeitar. **Validação com conjunto separado** (3 PDFs reais de um cliente/CNPJ fora do
   pool usado pra desenhar os modelos): 1/3 perfeito (DAS guia), 2/3 com zonas/âncoras que
   precisam de ajuste pra empresas multi-filial (PGDAS-D recibo/declaração) — modo sombra evitou
   que algum dado errado fosse auto-anexado em qualquer um dos casos; ajuste de
   `DocumentModel` fica como follow-up, não é bug de código. **OCR de imagem** deliberadamente
   fora deste v1 (documentos em imagem ficam `nao_identificado`) — próxima fase imediata depois
   deste plano, não indefinidamente adiada. **Plano B (tela de cadastro/modelagem de
   `DocumentModel` pelo `ORG_ADMIN`) concluído nesta mesma entrada**, ver abaixo.
   Ver `docs/superpowers/specs/2026-10-15-automacao-documentos-fiscais-design.md` e
   `docs/superpowers/plans/2026-10-15-automacao-documentos-fiscais-plan-a.md`.

   **Plano B — tela de modelagem** (concluído em 2026-10-18): `ORG_ADMIN` sobe um PDF de amostra
   em `/app/settings/document-models/new` (ou `/:id/edit`), a página reconstrói o texto já
   extraído como elementos clicáveis posicionados em `absolute` — sem renderizar o PDF como
   imagem/canvas, reusando `extrairDocumento` do Plano A direto no buffer do upload
   (`POST /document-reader/modelos/analisar`, nada persistido) — e o admin marca âncoras (textos
   fixos) e campos (CNPJ, Competência, Período/`pa` trimestral, Vencimento, Valor, ou um campo
   customizado) clicando nos itens. `ObligationType` pode ser criado inline (só o nome; o `code`
   é derivado automaticamente, com NFD pra não quebrar acento — "Férias" → "FERIAS", não
   "FRIAS"). O motor (`engine/pipeline.ts`) lê competência/período pelo NOME literal do campo
   (`"competencia"` ou `"pa"`), não pelo tipo — por isso a validação do modelo exige nome E tipo
   juntos, não só um campo do tipo certo com qualquer nome. Zonas marcadas ganham 10% de folga
   por lado (`MARGEM_ZONA`) ao redor do item clicado, mitigando a mesma brittleness que a
   validação com conjunto separado do Plano A já expôs pra empresas multi-filial. Salvo como
   `DocumentModel` sempre privado da org (nunca global — `organizationId` vem sempre do actor);
   `PATCH`/`DELETE` (soft-delete via `isActive`) checam escopo com 404, nunca revelando que um
   modelo de outra org existe. Durante a preparação deste plano foi encontrado e corrigido um bug
   de produção do Plano A: `carregarModelosDaOrg` gravava `{ id: r.id, ...definicao }`, deixando
   um `id` próprio dentro do JSON `definicao` (presente nos 4 seeds globais) sobrescrever o cuid
   real por ordem de spread — corrigido invertendo a ordem (commit `e31b5b2`). Fora de escopo v1
   (deferido de propósito, ver spec): sugestão automática de âncoras, teste ao vivo do rascunho,
   análise de impacto contra documentos já recebidos, clonar modelo global, histórico de versões.
   `/analisar` roda o parsing síncrono no event loop da API (não via fila BullMQ como o upload
   real) — registrado como débito técnico aceito pro v1, não redesenho (ver `docs/tech-debt.md`).
   Ver `docs/superpowers/specs/2026-10-16-modelagem-documentos-design.md` e
   `docs/superpowers/plans/2026-10-16-modelagem-documentos-plan.md`.
7. [x] **Protocolo digital com validade jurídica + IP** (concluído em 2026-10-12) —
   `Protocol`/`ProtocolEvent` (log append-only, mesmo padrão de `TaskHistory`/`NotificationLog`)
   pra documentos ou avisos formais com vencimento (ex: guia de imposto). Número sequencial por
   organização (`AAAA-NNNNNN`, via `ProtocolCounter` com increment atômico, sem corrida sob
   criação concorrente). Dois eventos distintos de visualização — abrir a tela (`VIEWED`) e
   baixar o arquivo (`DOWNLOADED`), nunca sobrescrevem o anterior — cada um grava IP, user-agent
   e email do `ClientUser` no momento do evento. Notificação (WhatsApp/email) nunca carrega o
   arquivo nem link de download direto, só avisa pra acessar o portal — força a visualização a
   acontecer num lugar rastreável. `EXPIRED` só dispara se o prazo passou e nunca houve
   visualização; roda incondicionalmente no cron diário, mesmo com o digest de SLA desligado.
   Digest diário estendido (não um cron novo) com seção de protocolos sem visualização/vencidos.
   Comprovante exportável em HTML pronto pra impressão (decisão explícita: sem Puppeteer/PDF no
   servidor, pra evitar problema de Chromium no Alpine), com aviso explícito de que o IP é
   evidência de apoio, não assinatura digital certificada. `trustProxy: 1` no Fastify —
   pré-requisito pro IP capturado refletir o cliente real, não o proxy (Traefik). Fora de
   escopo nesta rodada, por decisão do usuário: assinatura eletrônica certificada e auditoria de
   isolamento de rede do Dokploy/Traefik (recomendação registrada pra mais tarde). Frontend: aba
   "Protocolos" no `TaskDrawer` (criar com anexo existente ou texto livre), tela "Meus
   Protocolos" no portal (filtro de status/busca), aba "Protocolos" no Dashboard (contagem +
   lista por urgência, linkando pro board certo). Ver
   `docs/superpowers/specs/2026-10-11-protocolo-digital-design.md` e
   `docs/superpowers/plans/2026-10-11-protocolo-digital-plan.md`.
8. [x] **Usuários de cliente com acesso por departamento** (concluído em 2026-09-21) — `ClientUser`/`ClientUserAccess`, login do portal desacoplado de `Client`, `Task.departmentId` obrigatório. Um `ClientUser` (pessoa) pode acessar mais de uma empresa (`Client`), com escopo de departamento por empresa; rotas de portal (`requests`, `tasks`, `documents`) agora exigem `clientId` explícito e validam contra o escopo de acesso do usuário. Tela dedicada de Usuários de Cliente (CRUD + reaproveitamento de usuário existente ao cadastrar empresa), seletor de empresa no portal quando há mais de uma. Ver `docs/superpowers/sdd/2026-09-21-client-users/`.
9. [x] **Kanban dinâmico, Templates de OS e código do cliente** (concluído em 2026-09-22) — coluna passa a ter `statusEffect` (`NONE`/`OPEN`/`STARTED`/`BLOCKED`/`DISREGARDED`/`DONE`, aplica o status na tarefa ao entrar na coluna) e `notifyClient` (notifica o cliente ao mover pra essa coluna, independente do toggle global da org), substituindo o antigo `isFinal`; `TaskStatus` ganha o valor `STARTED`. `OSTemplate`/`OSTemplateColumn`/`OSTemplateColumnDocument` (CRUD em `/os-templates`, `ORG_ADMIN` pra mutação) definem de uma vez as colunas (com `statusEffect`/`notifyClient`/checklist de documentos) que um board nasce com, usado tanto em `POST /boards` quanto em `POST /requests/:id/approve` (modo `NEW_BOARD`, template escolhido pelo cliente ao abrir a Solicitação via `GET /portal/os-templates`). `Client.codigo` — identificador curto opcional usado na busca e como prefixo do título do board criado a partir de uma Solicitação aprovada. `RecurringTaskAssignment` simplificado (vínculo direto por cliente, sem exigir board/coluna pré-existentes — board/coluna foram removidos do vínculo, não tornados diretos) e board oculto `RECURRING_SYSTEM` como "casa" das Tarefas Recorrentes sem processo. `GET /tasks` — listagem flat e filtrável (cliente, responsável, departamento, status, template recorrente, período, busca textual) atravessando todos os boards da org, inclusive o `RECURRING_SYSTEM`; base da tela unificada Tarefas (alternância Lista/Kanban dinâmico agrupado por status, cruzando tarefas de clientes diferentes). Frontend: telas de gestão de Templates de OS e Lista de OS, `Client.codigo` nos formulários/lista de clientes, seletor de tipo de solicitação (Template de OS) no portal. Ver `docs/superpowers/specs/2026-09-22-kanban-os-recorrente-redesign.md` e `docs/superpowers/plans/2026-09-22-kanban-os-recorrente-redesign.md`.

10. [x] **Cobertura de departamentos por cliente** (concluído em 2026-11-11) — "departamento
    atendido" = `ClientAssignment` com responsável do escritório. Invariantes garantidas no backend
    (`src/modules/clients/client-coverage.ts`): todo cliente tem ≥1 departamento atendido, todo
    atendido tem responsável e ≥1 usuário do cliente ativo, acesso do usuário só a departamento
    atendido, tarefa só em departamento atendido (criar, trocar departamento, gerar recorrente,
    aprovar solicitação) e mover tarefa só dentro do mesmo processo (antes dava pra mover pro
    processo de outro cliente), solicitação só em departamento a que o usuário tem acesso
    (`Request.departmentId` NOT NULL). Cliente: código do ERP obrigatório, CNPJ/CPF com dígito
    verificador e únicos entre ativos (índices parciais), endereço obrigatório pra PJ. Cadastro em
    3 abas (Empresa, Departamentos, Acesso ao portal) com painel de cobertura (vermelho bloqueia,
    amarelo avisa "ninguém recebe por WhatsApp"). Notificação ao cliente por departamento nos dois
    canais — WhatsApp vai pro telefone de cada usuário, não mais pro número da empresa; sai o
    fallback "notifica todos os admins". Tela "Transferir responsabilidades" (carteira por cliente,
    filtro por departamento, transferência em lotes, desativar ao zerar) e desativação de quem é
    responsável bloqueada. Falhas de geração de recorrentes com mensagem acionável, no topo do
    Dashboard (admin/gerente, com "Gerar novamente") e no resumo diário. Ver
    `docs/superpowers/specs/2026-11-11-cobertura-departamentos-cliente-design.md` e
    `docs/superpowers/plans/2026-11-11-cobertura-departamentos-cliente.md`.

### Próximos passos a discutir (anotados em 2026-11-11, não esquecer)

   **Atualização 2026-11-13:** ✅ visibilidade por departamento implementada (branch
   `feat/visibilidade-departamento`, plano `docs/superpowers/plans/2026-11-13-visibilidade-por-departamento.md`):
   colaborador pertence a departamentos, opção "ver colegas", filtro Minhas · Meu departamento · Todas,
   Assumir (uma e em lote), solicitação aprovada vai para quem aprovou. Pendente desta trilha só as ações
   fora do código abaixo.

   **Atualização 2026-11-12 (após a rodada de débitos e a auditoria de segurança):** ordem combinada
   com o Max — **primeiro** a visibilidade do Membro (fila do robô e solicitações, com filtro "minhas"
   por padrão e acesso ao departamento para cobrir colega ausente — ver `docs/tech-debt.md`, seção da
   auditoria); **por último** as ações fora do código: rotacionar a `DOKPLOY_API_KEY`, conferir o webhook
   do Asaas (se usa `?accessToken=` na URL, trocar pelo header `asaas-access-token` e rotacionar o
   `ASAAS_WEBHOOK_SECRET`) e conferir se o access log do Traefik está desligado.

Ordem combinada com o Max: item 10 (feito) → solicitações internas → retomar a rodada de testes
manuais validando os dois. Os demais itens entram conforme o que os testes revelarem.

   **Atualização 2026-11-12 (conversa com o Max):** o problema real são duas coisas separadas.
   (a) **Troca de informação entre departamentos** (ex.: Pessoal precisa de dado que o Fiscal
   preenche todo mês) — decidido fazer **atrelado ao cliente**, como o Nibo: dependência entre
   tarefas (a do Pessoal da empresa X fica "aguardando/bloqueada" até a do Fiscal da empresa X
   ser concluída, e a informação do Fiscal chega junto). Cabe no modelo atual, sem tarefa sem
   cliente. **Vem primeiro.** (b) **Rotinas do próprio escritório** sem cliente específico —
   esse sim exige tarefa sem cliente; fica depois de (a). Ordem combinada: testes manuais do que
   já existe → (a) → (b).

   **Atualização 2026-11-12 — novo portal do cliente (entra ANTES de (a)/(b), conversa em andamento):**
   testes manuais mostraram que "Minhas Tarefas" no portal mistura processos e recorrentes (~30/mês
   num cliente com todos os departamentos). Decidido seguir o modelo do Nibo (portal centrado em
   documentos, não em tarefas), mantendo Processos como diferencial do Tramita:
   - **Fase A — ✅ implementada em 2026-11-12** (branch `feat/portal-documentos`, plano
     `docs/superpowers/plans/2026-11-12-portal-cliente-documentos.md`):
     Início (cartões: guias a pagar, documentos a enviar, processos em andamento);
     **Documentos recebidos** (protocolos + competência, valor, tipo, status Não visto/Visto/Pago);
     **Enviar documentos** (pedidos agrupados por mês, cores vermelho/amarelo/verde, "Nada a
     enviar"); **Processos** (OS com etapas/progresso). A tela "Tarefas" sai do portal.
   - **Fase B:** Arquivo permanente (contrato social, sócios, certificado, procurações, certidões)
     com alerta de vencimento (certificado/certidão).
   - **Marcar como pago (decidido):** só o **cliente** marca (valor + comprovante opcional) — é
     controle dele. O escritório **só vê**, sem notificação ativa: indicador no Dashboard "N guias
     não pagas" (destaque vencidas) que abre a lista filtrada; o colaborador usa isso pra alertar o
     cliente de imposto alto no dia ou logo após vencer (juros). Entregas do template recorrente
     ganham a marca **"Exige pagamento"** (guia sim; extrato/declaração não) — só essas entram no
     indicador e mostram "Pago". Entrega avulsa: marca na hora de enviar.

1. **Solicitações internas** (próximo projeto, precisa de brainstorm + spec) — colaborador
   pedindo coisas a outro colaborador/departamento, referenciando ou não um cliente;
   "departamento interno" (que não atende cliente). Exige tarefa com cliente **opcional** hoje
   todo board tem `clientId` obrigatório — afeta portal, notificações, métricas, busca e SSE.
   Sempre invisível pro cliente e sem notificar o cliente.
2. **Retomar a rodada de testes manuais** do Max (fluxo ponta a ponta: cadastro → processo/OS →
   tarefas → solicitação pelo portal → notificações/dashboard), com monitor de logs ligado.
3. **Aba "Tarefas" no cadastro do cliente** — vincular tarefas recorrentes direto no cadastro
   (o formulário em abas do item 10 já nasce preparado pra uma 4ª aba).
4. **Convite por e-mail** pro usuário do cliente definir a própria senha (hoje o escritório
   define).
5. **Integração com o ERP contábil** pelo código do cliente (obrigatório e único a partir do
   item 10).
6. **Ideias do Nibo a discutir uma a uma** (pesquisa de 2026-11-11, memória
   `project_nibo_obrigacoes_research.md`): estados de encerramento com motivo (baixa justificada,
   cancelada); gate de aprovação ("Em aprovação"); checklist obrigatório pra concluir; alerta de
   atraso configurável; edição de recorrência "a partir de qual data" (regenera só o que está
   aberto); feed unificado (histórico + comentários + anexos numa timeline); dependência entre
   tarefas de um processo ("desbloquear tarefa" + acumulado de dias por etapa); robô de leitura
   com "não se aplica" por campo e teste obrigatório antes de salvar; matriz de documentos
   pedidos ao cliente (empresa × período, 3 cores).
7. **Worker não sobe no ambiente local** — ver `docs/tech-debt.md` (carregamento do `.env`
   depois dos imports ESM). Correção pequena, ainda pendente.

Schema-por-tenant segue como consideração arquitetural separada, não agendada (ver
`project_schema_per_tenant_consideration.md` na memória).