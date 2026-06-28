# Remover Feature de Relatório PDF (Puppeteer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover completamente a geração de relatório PDF (backend, frontend, dependência `puppeteer` e o Chromium do `apps/api/Dockerfile`), reduzindo o peso da imagem Docker da API, sem deixar código morto ou rota órfã.

**Architecture:** Remoção pura — sem reimplementação nesta entrega. Backend perde o módulo `reports` inteiro; frontend perde a página/aba/botão que chamavam o endpoint removido; `Dockerfile` da API volta a não precisar de Chromium.

**Tech Stack:** Node 22 + Fastify v5 (API), React 19 + Vite (Web), Docker.

## Global Constraints

- A aba "Relatórios" no portal e o botão "Exportar relatório" no Dashboard do escritório são removidos totalmente (sem placeholder/desabilitado).
- Documentação existente (`TASKS.md`, `ARCHITECTURE.md`, `SPEC.md`) recebe nota explicando a remoção — não é apagada como se nunca tivesse existido.
- `docs/tech-debt.md` perde a entrada "XSS no PDF de relatórios" (deixa de ser aplicável).
- Baseline de testes antes desta remoção: `pnpm --filter api test` → 31 arquivos / 177 testes passando (2 desses testes pertencem a `reports.service.test.ts`, que será deletado).

---

## Task 1: Remover o módulo `reports` do backend e a dependência `puppeteer`

**Files:**
- Delete: `apps/api/src/modules/reports/reports.routes.ts`
- Delete: `apps/api/src/modules/reports/reports.service.ts`
- Delete: `apps/api/src/modules/reports/reports.service.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml` (raiz, via `pnpm install`)

**Interfaces:**
- Nenhuma — remoção pura, nada depende deste módulo (confirmado: nenhum outro arquivo em `apps/api/src` importa de `@/modules/reports`).

- [ ] **Step 1: Confirmar que nada além do próprio módulo referencia `reports`**

```bash
cd /home/max/job/autohubs/tramita
grep -rln "modules/reports\|reportsRoutes" apps/api/src --include="*.ts"
```

Expected: só `apps/api/src/server.ts` aparece na lista (o único ponto de registro da rota) — se outro arquivo aparecer, parar e investigar antes de prosseguir, o plano assume que esse é o único ponto de acoplamento.

- [ ] **Step 2: Deletar os 3 arquivos do módulo `reports`**

```bash
rm -rf apps/api/src/modules/reports
```

- [ ] **Step 3: Remover o import e o registro da rota em `server.ts`**

Em `apps/api/src/server.ts`, remover a linha de import:

```typescript
import { reportsRoutes } from '@/modules/reports/reports.routes'
```

E remover a linha de registro (dentro de `buildApp()`):

```typescript
  app.register(reportsRoutes)
```

- [ ] **Step 4: Remover `puppeteer` de `apps/api/package.json`**

Em `apps/api/package.json`, no bloco `"dependencies"`, remover a linha:

```json
    "puppeteer": "^25.1.0",
```

- [ ] **Step 5: Atualizar o lockfile**

```bash
cd /home/max/job/autohubs/tramita
pnpm install
```

Expected: termina sem erro; `pnpm-lock.yaml` é modificado (remoção da entrada `puppeteer` e suas dependências exclusivas).

- [ ] **Step 6: Confirmar que o build da API ainda passa**

```bash
pnpm --filter api build
echo "EXIT=$?"
```

Expected: `EXIT=0`, sem erro de módulo não encontrado (`@/modules/reports` não existe mais em nenhum import).

- [ ] **Step 7: Rodar a suíte de testes da API**

```bash
pnpm --filter api test
```

Expected: PASS, `30 arquivos / 175 testes` (177 da baseline menos os 2 testes de `reports.service.test.ts`, que foi deletado).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/server.ts apps/api/package.json pnpm-lock.yaml
git add -u apps/api/src/modules/reports
git commit -m "feat(api)!: remover módulo de relatório PDF e dependência puppeteer"
```

(`git add -u` registra a deleção dos 3 arquivos do módulo; o `!` no tipo do commit sinaliza breaking change na API pública, já que o endpoint `GET /clients/:clientId/report` deixa de existir.)

---

## Task 2: Remover o frontend da feature de relatório

**Files:**
- Delete: `apps/web/src/pages/portal/Reports.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/portal/Layout.tsx`
- Modify: `apps/web/src/pages/app/Dashboard.tsx`

**Interfaces:**
- Consumes: nenhuma interface do backend (a Task 1 já removeu o endpoint que esses arquivos chamavam) — esta task é puramente de remoção de UI.

- [ ] **Step 1: Deletar a página do portal**

```bash
cd /home/max/job/autohubs/tramita
rm apps/web/src/pages/portal/Reports.tsx
```

- [ ] **Step 2: Remover a rota e o lazy import em `router.tsx`**

Em `apps/web/src/router.tsx`, remover a linha:

```typescript
const PortalReports = lazy(() => import('@/pages/portal/Reports'))
```

E remover a rota filha dentro do bloco `/portal`:

```typescript
      { path: 'reports', element: <PortalReports /> },
```

- [ ] **Step 3: Remover a aba "Relatórios" e o import não usado de `FileText` em `Layout.tsx`**

Substituir o conteúdo de `apps/web/src/pages/portal/Layout.tsx` (só a linha de import dos ícones e o array `tabs` mudam — todo o resto do arquivo permanece idêntico):

```typescript
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutGrid, User, LogOut, Inbox } from 'lucide-react'

const tabs = [
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos' },
  { to: '/portal/requests', icon: Inbox, label: 'Solicitações' },
  { to: '/portal/profile', icon: User, label: 'Perfil' },
] as const
```

(O restante do arquivo — `export default function PortalLayout()` em diante — não muda.)

- [ ] **Step 4: Remover `handleExportReport` e o botão "Exportar relatório" em `Dashboard.tsx`**

Em `apps/web/src/pages/app/Dashboard.tsx`, remover a função inteira:

```typescript
  async function handleExportReport(clientId: string, clientName: string) {
    const month = new Date().toISOString().slice(0, 7)
    try {
      const res = await api.get(`/clients/${clientId}/report?month=${month}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${clientName}-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Relatório não disponível para este período.')
    }
  }
```

E remover o botão dentro do `.map` de boards (fica só o `{overdueTasks > 0 && (...)}` antes do fechamento do `</CardContent>`):

```typescript
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        handleExportReport(board.client.id, board.client.name)
                      }}
                      className="mt-2 text-xs text-blue-500 hover:text-blue-700 hover:underline"
                    >
                      Exportar relatório
                    </button>
```

- [ ] **Step 5: Verificar compilação**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter web exec tsc --noEmit
```

Expected: sem erro novo (a baseline conhecida tem só o erro pré-existente não relacionado em `useBoard.test.tsx` se ainda existir — confirme que não surgiu nada novo referente a `Reports`/`FileText`/`handleExportReport`).

- [ ] **Step 6: Rodar os testes do frontend**

```bash
pnpm --filter web test
```

Expected: mesma baseline conhecida (sem teste cobria `PortalReports`/`handleExportReport` diretamente, então a contagem de testes não deve mudar por esta remoção especificamente — qualquer falha nova precisa ser investigada).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/router.tsx apps/web/src/pages/portal/Layout.tsx apps/web/src/pages/app/Dashboard.tsx
git add -u apps/web/src/pages/portal/Reports.tsx
git commit -m "feat(web)!: remover aba de relatórios do portal e botão de exportar no dashboard"
```

---

## Task 3: Simplificar `apps/api/Dockerfile` — remover Chromium

**Files:**
- Modify: `apps/api/Dockerfile`

**Interfaces:**
- Consumes: nenhuma — a imagem já buildava e bootava corretamente com Chromium (verificado na Task 4 do plano de deploy); esta task só remove o que não é mais necessário, sem mudar a estrutura de stages.

- [ ] **Step 1: Confirmar o conteúdo atual do `runtime` stage antes de editar**

```bash
cd /home/max/job/autohubs/tramita
sed -n '/FROM node:22-alpine AS runtime/,/^WORKDIR \/repo$/p' apps/api/Dockerfile
```

Expected: mostra o bloco que inclui `RUN corepack enable && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont` e as variáveis `ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser NODE_ENV=production` — confirme que o conteúdo real bate com isso antes do próximo step (pode ter mudado de forma incidental desde a escrita deste plano).

- [ ] **Step 2: Remover Chromium e as variáveis do Puppeteer**

No `apps/api/Dockerfile`, trocar:

```dockerfile
# ---- runtime: só o necessário pra rodar, com Chromium de sistema pro Puppeteer ----
FROM node:22-alpine AS runtime
RUN corepack enable \
  && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production
```

por:

```dockerfile
# ---- runtime: só o necessário pra rodar ----
FROM node:22-alpine AS runtime
RUN corepack enable
ENV NODE_ENV=production
```

(O restante do `Dockerfile` — `deps`, `build`, e o resto do `runtime` stage abaixo desse bloco — não muda nesta task.)

- [ ] **Step 3: Rebuildar a imagem**

```bash
cd /home/max/job/autohubs/tramita
docker build -f apps/api/Dockerfile -t tramita-api:test .
```

Expected: build termina sem erro, mais rápido que antes (sem instalar Chromium).

- [ ] **Step 4: Confirmar que a imagem ficou menor**

```bash
docker images tramita-api:test --format "{{.Size}}"
```

Expected: tamanho visivelmente menor que o registrado antes desta remoção (Chromium + libs de sistema representavam a maior parte do peso da imagem) — não precisa bater um valor exato, só confirmar a redução.

- [ ] **Step 5: Confirmar que a imagem ainda sobe e responde `/health`**

Os containers `client-requests-postgres-1`/`client-requests-redis-1` precisam estar no ar (`docker start client-requests-postgres-1 client-requests-redis-1` se não estiverem).

```bash
cd /home/max/job/autohubs/tramita
docker run --rm -d --name tramita-api-notest \
  --network host \
  -e DATABASE_URL="postgresql://tramita:tramita@localhost:5432/tramita" \
  -e REDIS_URL="redis://localhost:6379" \
  -e PORT=3097 \
  -e JWT_PRIVATE_KEY="$(grep ^JWT_PRIVATE_KEY= .env | cut -d= -f2-)" \
  -e JWT_PUBLIC_KEY="$(grep ^JWT_PUBLIC_KEY= .env | cut -d= -f2-)" \
  -e ENCRYPTION_KEY="$(grep ^ENCRYPTION_KEY= .env | cut -d= -f2-)" \
  tramita-api:test
sleep 4
curl -s http://localhost:3097/health
docker logs tramita-api-notest --tail 20
docker stop tramita-api-notest
```

Expected: `{"status":"ok"}`, migrations aplicadas sem erro, sem stack trace.

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile
git commit -m "feat(infra): remover Chromium do Dockerfile da API — feature de relatório PDF removida"
```

---

## Task 4: Atualizar documentação

**Files:**
- Modify: `docs/TASKS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SPEC.md`
- Modify: `docs/tech-debt.md`

**Interfaces:**
- Nenhuma — só documentação.

- [ ] **Step 1: Adicionar nota na Fase 8d de `docs/TASKS.md`**

Localizar a seção (linha ~177 no momento da escrita deste plano — confirme a localização real antes de editar):

```
### 8d — Relatório PDF ✅
- [x] `GET /clients/:clientId/report?month=YYYY-MM` — gera PDF com cache Redis 1h
- [x] Conteúdo: cabeçalho org, resumo executivo, tabela de tarefas, histórico do período
- [x] Frontend interno: botão "Exportar relatório"
```

Adicionar, imediatamente depois do último item dessa subseção (mantendo os checkboxes `[x]` como estão — não desmarcar):

```
### 8d — Relatório PDF ✅
- [x] `GET /clients/:clientId/report?month=YYYY-MM` — gera PDF com cache Redis 1h
- [x] Conteúdo: cabeçalho org, resumo executivo, tabela de tarefas, histórico do período
- [x] Frontend interno: botão "Exportar relatório"

**Nota (2026-06-28):** feature removida — o Chromium necessário pro Puppeteer
inflava demais a imagem Docker da API (~1.4GB, majoritariamente Chromium e
libs de sistema). Reimplementação planejada com abordagem mais leve (sem
browser headless completo), em sessão futura.
```

- [ ] **Step 2: Adicionar nota equivalente em `docs/ARCHITECTURE.md`**

Localizar a linha `- **PDF:** Puppeteer` (seção de stack, por volta da linha 38) e trocar por:

```
- **PDF:** ~~Puppeteer~~ (removido em 2026-06-28 — Chromium inflava a imagem Docker; reimplementação futura com abordagem mais leve)
```

E localizar a linha `- Features habilitadas (relatório PDF, SSE, anexos, etc.)` (seção de planos, por volta da linha 158) — deixar como está, é só um exemplo genérico de feature de plano, não uma afirmação de que a feature existe hoje (não precisa de nota aqui).

- [ ] **Step 3: Adicionar nota em `docs/SPEC.md`**

Localizar a seção (por volta da linha 360):

```
## Relatório PDF

### GET `/clients/:clientId/report?month=YYYY-MM` _(ORG_ADMIN | ORG_MANAGER)_
Retorna `Content-Type: application/pdf`. Cache Redis 1h.
```

Adicionar uma nota logo abaixo, mantendo a documentação original do endpoint como histórico:

```
## Relatório PDF

### GET `/clients/:clientId/report?month=YYYY-MM` _(ORG_ADMIN | ORG_MANAGER)_
Retorna `Content-Type: application/pdf`. Cache Redis 1h.

**Removido em 2026-06-28** — endpoint não existe mais nesta versão da API
(Chromium/Puppeteer inflava a imagem Docker). Reimplementação futura
planejada com abordagem mais leve.
```

- [ ] **Step 4: Remover a entrada de débito técnico do PDF em `docs/tech-debt.md`**

Em `docs/tech-debt.md`, remover a seção inteira:

```
## XSS no PDF de relatórios — `buildReportHtml` não escapa dados do usuário

**Contexto:** `apps/api/src/modules/reports/reports.service.ts`, função `buildReportHtml`, interpola `orgName`, `clientName`, `t.title`, `t.status`, `t.priority` diretamente em uma string HTML sem nenhum escape, antes de passar pro Puppeteer (`page.setContent(html, ...)`) pra gerar o PDF. Um nome de organização ou cliente contendo `<script>` (ou tags HTML em geral) seria refletido e executado no contexto da página renderizada pelo Chromium antes do PDF ser gerado — risco real de XSS, ainda que o impacto prático seja limitado (o output final é só o PDF, sem cookies/sessão ativa nessa página headless).

**Pendente:** escapar (`encodeHTMLEntities`/equivalente) todos os valores interpolados em `buildReportHtml` antes de montar a string HTML.
```

(Deixa de ser débito técnico relevante porque a função inteira foi deletada na Task 1 — não há mais código pra ter esse risco.)

- [ ] **Step 5: Commit**

```bash
git add docs/TASKS.md docs/ARCHITECTURE.md docs/SPEC.md docs/tech-debt.md
git commit -m "docs: registrar remoção da feature de relatório PDF na documentação"
```

---

## Self-Review

- **Cobertura do spec:** backend (Task 1), frontend (Task 2), Docker (Task 3), documentação (Task 4) — todas as 5 seções do spec têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — toda task tem conteúdo exato.
- **Consistência:** contagem de testes esperada (175 após Task 1) é consistente com a baseline confirmada (177, menos os 2 testes de `reports.service.test.ts`).
- **Ordem das tasks:** Task 1 (backend) antes da Task 3 (Dockerfile) é proposital — o Dockerfile builda o backend, então remover a dependência `puppeteer` do `package.json` antes de simplificar o `Dockerfile` evita um build intermediário inconsistente (ainda que tecnicamente as duas tasks sejam independentes uma da outra em termos de arquivos tocados).
- **Fora de escopo (igual ao spec):** reimplementação de relatórios, qualquer ajuste no restante do `docker-deploy-plan.md` (compose de produção, etc.) além do próprio `Dockerfile` da API.
