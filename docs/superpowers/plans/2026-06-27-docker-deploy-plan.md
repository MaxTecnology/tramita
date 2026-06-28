# Containerização e Deploy (Dokploy) — Fase 9 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a Tramita pronta para deploy no Dokploy (Traefik global já existente) com Dockerfiles multi-stage para `api`/`web`, um `docker-compose.prod.yml`, e um jeito de testar as mesmas imagens localmente antes do deploy — corrigindo, antes disso, três problemas reais que impedem o build/boot de produção da API hoje (rootDir do tsconfig, `moduleResolution` incompatível com os aliases `@/` + 11 erros de tipo que ela mascarava, e a ausência de reescrita de aliases em runtime).

**Architecture:** Dois Dockerfiles multi-stage (Node 22 Alpine para a API com Chromium de sistema para o Puppeteer; Node 22 Alpine + Nginx Alpine para o web). `docker-compose.prod.yml` com `api`/`worker`/`web` conectados à rede externa `dokploy-network` via labels Traefik, sem publicar portas. `docker-compose.local-test.yml` como override que substitui a rede por uma local e redireciona `DATABASE_URL`/`REDIS_URL` para `host.docker.internal`, permitindo testar as imagens de produção na máquina do desenvolvedor sem Traefik.

**Tech Stack:** Docker, Docker Compose, Nginx Alpine, Node 22 Alpine, pnpm workspaces, tsc-alias.

## Global Constraints

- Domínios: `tramita.autohubs.com.br` (web) e `tramitaapi.autohubs.com.br` (api) — subdomínios separados, CORS já habilitado em `apps/api/src/plugins/cors.ts`.
- Traefik global do Dokploy já existe — não subir Traefik próprio neste projeto.
- Postgres/Redis de produção já existem no Dokploy (gerenciados separadamente) — `docker-compose.prod.yml` não os inclui.
- Puppeteer continua embutido na imagem da API (sem microserviço separado).
- Frontend de produção servido por `nginx:alpine`.
- `docker-compose.yml` atual (dev, só Postgres/Redis) não é alterado — o fluxo `pnpm --filter api dev` continua funcionando como hoje.
- `docker-compose.prod.yml` não publica portas no host — ingress só via Traefik na rede `dokploy-network`.
- Nenhuma porta/serviço deve ser exposta sem necessidade; secrets nunca hardcoded — sempre via variável de ambiente.

---

## Task 1: Corrigir `tsconfig.json` da API — `rootDir` incluindo arquivos fora de `src`

**Problema confirmado:** `pnpm --filter api build` falha hoje com `TS6059: File '.../prisma/seed.ts' is not under 'rootDir'`, porque `apps/api/tsconfig.json` tem `"include": ["src/**/*", "prisma/**/*"]` mas `"rootDir": "src"` — o TypeScript exige que todo arquivo incluído esteja dentro do `rootDir`. `prisma/seed.ts` e `prisma/e2e-seed.ts` não são importados por nenhum arquivo em `src/` (rodam standalone via `tsx prisma/seed.ts`, configurado em `package.json#prisma.seed`) — não precisam ser compilados pelo `tsc` do build principal.

**Files:**
- Modify: `apps/api/tsconfig.json`

**Interfaces:**
- Nenhuma — só remove um padrão de `include`, não afeta nenhum import/export usado por outro código.

- [ ] **Step 1: Confirmar o erro atual**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api build
```

Expected: FAIL com `error TS6059: File '.../apps/api/prisma/e2e-seed.ts' is not under 'rootDir'` e o mesmo erro para `seed.ts`.

- [ ] **Step 2: Remover `"prisma/**/*"` do `include`**

Editar `apps/api/tsconfig.json` (conteúdo atual completo abaixo, só a linha de `include` muda):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Confirmar que o build passa**

```bash
pnpm --filter api build
```

Expected: PASS, sem nenhum erro. `apps/api/dist/app.js` e `apps/api/dist/worker.js` (e o restante da árvore de `src/`) devem existir.

- [ ] **Step 4: Confirmar que o seed ainda funciona via tsx (não foi afetado)**

```bash
cd apps/api
set -a && source ../../.env && set +a && pnpm exec tsx prisma/seed.ts
```

Expected: `Seed concluído: planos Starter/Pro/Enterprise, usuário MASTER, org G2A` (ou equivalente — o seed não muda de comportamento, só confirma que `tsx` ainda compila esse arquivo independentemente do `tsconfig.json` principal, já que `tsx` não usa `include`/`rootDir` para decidir o que executar).

- [ ] **Step 5: Rodar a suíte de testes da API pra garantir que nada quebrou**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api test
```

Expected: PASS, mesma contagem de testes de antes desta mudança (a alteração não toca em `src/`, só na config de build).

- [ ] **Step 6: Commit**

```bash
git add apps/api/tsconfig.json
git commit -m "fix(api): remover prisma/**/* do tsconfig — arquivos fora do rootDir quebravam o build"
```

---

## Task 2: Corrigir `moduleResolution` do `tsc` e os erros de tipo reais que ela revelava

**Problema confirmado:** mesmo depois da Task 1, `pnpm --filter api build` reporta **345 erros de tipo** `TS2307: Cannot find module '@/lib/...'` — para praticamente todo arquivo do projeto. Causa raiz: `tsconfig.base.json` define `"moduleResolution": "NodeNext"`, que exige extensão de arquivo explícita até para resolução via `paths` (aliases `@/...`) — o projeto usa aliases sem extensão em todo lugar (`@/lib/prisma`, não `@/lib/prisma.js`), o que é incompatível com `NodeNext`. Isso nunca foi percebido porque `tsx` (dev) e `vitest`/Vite (testes) usam resolvedores próprios, mais permissivos, que não se importam com essa exigência — só o `tsc` puro (usado no build de produção) é afetado.

**A correção já existe no próprio repositório:** `apps/web/tsconfig.json` já sobrescreve `module`/`moduleResolution` localmente (sem tocar em `tsconfig.base.json`) exatamente para evitar esse problema. Replicar o mesmo padrão em `apps/api/tsconfig.json` resolve os 345 erros — restando apenas **11 erros de tipo reais e pré-existentes**, sem relação com aliases, distribuídos em 4 causas distintas:

1. **Duas versões de `ioredis` instaladas** (`bullmq` fixa `ioredis@5.10.1`, a API usa `^5.6.0` → resolve para `5.11.0`) — gera tipos `Redis` estruturalmente incompatíveis entre si. Afeta `src/lib/queue.ts:15`, `src/workers/duedate.cron.ts:7,42`, `src/workers/notification.worker.ts:199`.
2. **`reply.getHeaders()` espalhado em `raw.writeHead()`** produz um tipo mais largo que `OutgoingHttpHeaders` do Node — `src/lib/sse.ts:35`.
3. **`getTemplate()` declara retorno `subject?: string`**, mas o registro do Prisma (`MessageTemplate.subject`) é `string | null` — `null` não é atribuível a `string | undefined` — `src/lib/template.ts:44`.
4. **Campo `clientId` morto** passado pro objeto `CommentActor` em `comments.routes.ts:32` — a interface `CommentActor` (em `comments.service.ts`) nunca teve esse campo; `createComment` já deriva o cliente via `actor.id` quando `actor.role === 'CLIENT'`, então esse campo nunca foi lido — sobrou de um refactor anterior.
5. **`page.setContent(html, { waitUntil: 'networkidle0' })`** — a versão instalada do Puppeteer (`^25.1.0`) só aceita `'load'`/`'domcontentloaded'` para `setContent` (diferente de `page.goto`, que aceita as variantes `networkidle`). O HTML do relatório é gerado localmente via `buildReportHtml()` (sem `<img src=http>`, `<link href=http>` ou fontes externas — confirmado por busca no arquivo), então `'load'` é equivalente em comportamento pra esse caso — `src/modules/reports/reports.service.ts:98`.
6. **`error` tipado como `unknown` no error handler do Fastify** — `app.setErrorHandler((error, ...) => ...)` não tem o parâmetro `error` anotado explicitamente como `FastifyError` — `src/server.ts:54-55`.

**Files:**
- Modify: `apps/api/tsconfig.json`
- Modify: `package.json` (raiz do monorepo)
- Modify: `apps/api/src/lib/sse.ts`
- Modify: `apps/api/src/lib/template.ts`
- Modify: `apps/api/src/modules/comments/comments.routes.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: nenhuma interface de outra task.
- Produces: `pnpm --filter api build` agora termina com exit code `0` (sem nenhum erro de tipo) — pré-requisito pra Task 4 (`Dockerfile` da API, cujo build roda exatamente esse comando dentro do container e abortaria com qualquer erro).

- [ ] **Step 1: Confirmar a explosão de erros após a Task 1**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api build 2>&1 | grep -c "error TS"
```

Expected: `345` (ou um número na mesma ordem de grandeza — não precisa bater exatamente, já que pode variar com a ordem de varredura do `tsc`; o importante é confirmar que é uma quantidade grande, dominada por `TS2307`, não os 11 erros reais).

- [ ] **Step 2: Corrigir `apps/api/tsconfig.json` — sobrescrever `module`/`moduleResolution` e adicionar tipos do Vitest**

Substituir o conteúdo de `apps/api/tsconfig.json` (o resultado da Task 1) por:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

(`"types": ["vitest/globals"]` é necessário porque os arquivos `*.test.ts` ficam dentro de `src/**/*` e usam `describe`/`it`/`afterEach`/`beforeAll` como globais — sem essa entrada, o `tsc` reporta `Cannot find name 'afterEach'` etc. para todo arquivo de teste.)

- [ ] **Step 3: Confirmar que os 345 erros de alias desaparecem, restando só os 11 reais**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api exec tsc 2>&1 | grep "error TS"
```

Expected: exatamente estas 11 linhas (a ordem pode variar):

```
src/lib/queue.ts(15,68): error TS2322: Type 'Redis' is not assignable to type 'ConnectionOptions'.
src/lib/sse.ts(35,22): error TS2769: No overload matches this call.
src/lib/template.ts(44,3): error TS2322: Type 'TemplateEntry | { ... }' is not assignable to type '{ body: string; subject?: string | undefined; }'.
src/modules/comments/comments.routes.ts(32,9): error TS2353: Object literal may only specify known properties, and 'clientId' does not exist in type 'CommentActor'.
src/modules/reports/reports.service.ts(98,33): error TS2322: Type '"networkidle0"' is not assignable to type '"load" | "domcontentloaded" | ("load" | "domcontentloaded")[] | undefined'.
src/server.ts(54,9): error TS18046: 'error' is of type 'unknown'.
src/server.ts(55,27): error TS18046: 'error' is of type 'unknown'.
src/server.ts(55,61): error TS18046: 'error' is of type 'unknown'.
src/workers/duedate.cron.ts(7,49): error TS2322: Type 'Redis' is not assignable to type 'ConnectionOptions'.
src/workers/duedate.cron.ts(42,8): error TS2322: Type 'Redis' is not assignable to type 'ConnectionOptions'.
src/workers/notification.worker.ts(199,5): error TS2322: Type 'Redis' is not assignable to type 'ConnectionOptions'.
```

- [ ] **Step 4: Corrigir a duplicidade de `ioredis` — adicionar `pnpm.overrides` no `package.json` da raiz**

`bullmq` fixa `ioredis@5.10.1` como dependência exata; a API pede `^5.6.0`, que resolve para uma versão mais nova (`5.11.0` no momento da escrita deste plano — confirme a versão real instalada com `pnpm --filter api why ioredis` antes de decidir o valor do override, caso tenha mudado). O `pnpm.overrides` força as duas a resolverem pra uma única versão.

Editar `/home/max/job/autohubs/tramita/package.json` (conteúdo completo atual mostrado abaixo, só o bloco `"pnpm"` é novo):

```json
{
  "name": "tramita",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "test:api": "pnpm --filter api test",
    "test:web": "pnpm --filter web test"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=10"
  },
  "pnpm": {
    "overrides": {
      "ioredis": "^5.11.0"
    }
  }
}
```

Se `pnpm --filter api why ioredis` (rodado antes deste step) mostrar uma versão diferente de `5.11.0` instalada, usar essa versão real no lugar de `^5.11.0` acima — o objetivo é fazer as duas dependências (`api` direta e `bullmq` transitiva) convergirem pra UMA única versão instalada, qualquer que ela seja.

- [ ] **Step 5: Aplicar o override e confirmar que sobra só uma versão de `ioredis`**

```bash
cd /home/max/job/autohubs/tramita
pnpm install
pnpm --filter api why ioredis
```

Expected: a saída do `pnpm install` termina sem erro, e `pnpm --filter api why ioredis` mostra `Found 1 version of ioredis` (em vez de 2).

- [ ] **Step 6: Corrigir `src/lib/sse.ts` — cast explícito do header mesclado**

Em `apps/api/src/lib/sse.ts`, adicionar `OutgoingHttpHeaders` ao import do topo do arquivo:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { OutgoingHttpHeaders } from 'node:http'
import { redis } from '@/lib/redis'
```

E no bloco `raw.writeHead(200, {...})` dentro de `attachSSESubscriber`, adicionar `as OutgoingHttpHeaders` ao objeto mesclado:

```typescript
  raw.writeHead(200, {
    ...reply.getHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  } as OutgoingHttpHeaders)
```

(Esse é um cast de tipo, não uma mudança de comportamento — o objeto já era estruturalmente compatível em runtime; o `tsc` só não conseguia provar isso porque o tipo de retorno de `reply.getHeaders()` do Fastify é mais amplo que o `OutgoingHttpHeaders` nativo do Node.)

- [ ] **Step 7: Corrigir `src/lib/template.ts` — alinhar o tipo de retorno de `getTemplate` com o campo `subject` do Prisma**

Em `apps/api/src/lib/template.ts`, trocar a assinatura de `getTemplate`:

```typescript
export async function getTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
): Promise<{ body: string; subject?: string }> {
```

por:

```typescript
export async function getTemplate(
  organizationId: string,
  event: NotificationEvent,
  channel: MessageChannel,
): Promise<{ body: string; subject?: string | null }> {
```

(O campo `subject` do model `MessageTemplate` do Prisma é `String?`, que o Prisma Client tipa como `string | null` — não `string | undefined`. Os chamadores de `getTemplate` já tratam `subject` com `?? ''`/`??` em todo lugar, então aceitar `null` não muda nenhum comportamento de runtime.)

- [ ] **Step 8: Corrigir `src/modules/comments/comments.routes.ts` — remover o campo `clientId` morto**

Em `apps/api/src/modules/comments/comments.routes.ts`, na chamada de `createComment` dentro da rota `POST /tasks/:taskId/comments`, remover a linha `clientId: ...`:

```typescript
    return reply.status(201).send(
      await createComment(taskId, result.data, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      })
    )
```

(Confirme antes de remover que `createComment`/`CommentActor`, em `apps/api/src/modules/comments/comments.service.ts`, realmente não usa nenhum campo `clientId` no objeto `actor` — a função já deriva a identidade do cliente via `actor.id` quando `actor.role === 'CLIENT'`. Se esse comportamento tiver mudado desde a escrita deste plano, pare e avalie antes de remover.)

- [ ] **Step 9: Corrigir `src/modules/reports/reports.service.ts` — trocar `waitUntil` pra um valor aceito por `setContent`**

Em `apps/api/src/modules/reports/reports.service.ts`, trocar:

```typescript
  await page.setContent(html, { waitUntil: 'networkidle0' })
```

por:

```typescript
  await page.setContent(html, { waitUntil: 'load' })
```

- [ ] **Step 10: Corrigir `src/server.ts` — anotar o parâmetro `error` do error handler**

Em `apps/api/src/server.ts`, adicionar `FastifyError` ao import do `fastify` no topo do arquivo:

```typescript
import Fastify from 'fastify'
import type { FastifyError } from 'fastify'
```

E anotar o parâmetro `error` no `setErrorHandler`:

```typescript
  app.setErrorHandler((error: FastifyError, _request, reply) => {
```

- [ ] **Step 11: Confirmar que o build passa com exit code 0**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api build
echo "EXIT=$?"
```

Expected: `EXIT=0`, sem nenhuma linha `error TS`.

- [ ] **Step 12: Rodar a suíte de testes da API**

```bash
pnpm --filter api test
```

Expected: PASS, mesma contagem da baseline (177/177) — nenhuma das correções desta task mudou comportamento de runtime (são cast/anotação de tipo, troca de uma constante do Puppeteer por outra equivalente para este caso, remoção de um campo nunca lido, e dedupe de uma dependência transitiva).

- [ ] **Step 13: Commit**

```bash
git add apps/api/tsconfig.json package.json pnpm-lock.yaml apps/api/src/lib/sse.ts apps/api/src/lib/template.ts apps/api/src/modules/comments/comments.routes.ts apps/api/src/modules/reports/reports.service.ts apps/api/src/server.ts
git commit -m "fix(api): corrigir moduleResolution do tsc e os 11 erros de tipo reais que ela revelava"
```

---

## Task 3: Corrigir resolução de alias `@/` em runtime (build de produção não inicializa)

**Problema confirmado:** mesmo com o `tsc` passando (Task 1), o `dist/app.js` resultante mantém os imports `@/server`, `@/plugins/cors` etc. literalmente — o `tsc` puro **não** reescreve path aliases (`paths` do tsconfig) para imports relativos no JS de saída. Rodar `node dist/app.js` falha com:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/server' imported from .../apps/api/dist/app.js
```

Isso significa que o script `"start": "node dist/app.js"` do `apps/api/package.json` **nunca funcionou** em produção — é exatamente o que o container Docker vai executar, então precisa ser corrigido antes de containerizar. Solução padrão para esse cenário (NodeNext + ESM + path aliases + `tsc`): `tsc-alias`, que reescreve os aliases para caminhos relativos no JS já compilado, como um passo extra depois do `tsc`.

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: nenhuma interface de outra task.
- Produces: `pnpm --filter api build` agora produz JS com imports relativos (sem `@/`), executável diretamente por `node` sem nenhum loader/registro extra.

- [ ] **Step 1: Confirmar o erro atual de runtime**

```bash
cd /home/max/job/autohubs/tramita/apps/api
node dist/app.js
```

Expected: FAIL com `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/server' imported from .../dist/app.js`.

- [ ] **Step 2: Instalar `tsc-alias` como devDependency da API**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api add -D tsc-alias
```

Expected: `tsc-alias` aparece em `apps/api/package.json` nas `devDependencies` (a versão exata fica a cargo do que o pnpm resolver — não precisa fixar manualmente).

- [ ] **Step 3: Atualizar o script de build pra rodar `tsc-alias` depois do `tsc`**

Em `apps/api/package.json`, trocar a linha:

```json
    "build": "tsc",
```

por:

```json
    "build": "tsc && tsc-alias -p tsconfig.json",
```

- [ ] **Step 4: Rebuildar e confirmar que os aliases foram reescritos**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api build
grep -n "@/server" apps/api/dist/app.js
```

Expected: o `grep` não retorna nada (o import foi reescrito para um caminho relativo, ex.: `import { buildApp } from './server.js';`).

- [ ] **Step 5: Confirmar que `node dist/app.js` agora inicializa de verdade**

Os containers Postgres (`client-requests-postgres-1`, porta 5432) e Redis (`client-requests-redis-1`, porta 6379) precisam estar no ar — se não estiverem: `docker start client-requests-postgres-1 client-requests-redis-1 client-requests-postgres_test-1`.

```bash
cd /home/max/job/autohubs/tramita/apps/api
set -a && source ../../.env && set +a && node dist/app.js &
sleep 2
curl -s http://localhost:3000/health
kill %1
```

Expected: `curl` retorna `{"status":"ok"}` (ou equivalente — ver `GET /health` em `apps/api/src/server.ts`). O processo em background é finalizado pelo `kill %1` ao final.

- [ ] **Step 6: Confirmar que `node dist/worker.js` também inicializa (mesmo problema de alias)**

```bash
cd /home/max/job/autohubs/tramita/apps/api
set -a && source ../../.env && set +a && timeout 3 node dist/worker.js
echo "EXIT=$?"
```

Expected: imprime `[worker] Notification worker + duedate cron iniciados` antes do `timeout` matar o processo (`EXIT=124` é o código do `timeout`, esperado — não é falha).

- [ ] **Step 7: Rodar a suíte de testes da API**

```bash
cd /home/max/job/autohubs/tramita
pnpm --filter api test
```

Expected: PASS, mesma contagem de antes (os testes usam `tsx`/`vitest` diretamente sobre `src/`, não passam pelo `dist/` — não deveriam ser afetados, mas confirme).

- [ ] **Step 8: Commit**

```bash
cd /home/max/job/autohubs/tramita
git add apps/api/package.json pnpm-lock.yaml
git commit -m "fix(api): adicionar tsc-alias — build de produção não resolvia imports @/ em runtime"
```

(O `pnpm-lock.yaml` é único para todo o pnpm workspace e vive na raiz do monorepo — `pnpm --filter api add -D` no Step 2 atualiza esse arquivo da raiz, não um lockfile dentro de `apps/api/`.)

---

## Task 4: `apps/api/Dockerfile` + `entrypoint.sh`

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/api/entrypoint.sh`

**Interfaces:**
- Consumes: `pnpm --filter api build` (Tasks 1+2, já corrigido e funcional), `pnpm --filter api exec prisma generate`, script `migrate:deploy`-equivalente (`prisma migrate deploy`).
- Produces: imagem Docker `tramita-api` (nome local de teste) que expõe a porta `3000`, com `ENTRYPOINT` rodando migrations antes do processo principal.

- [ ] **Step 1: Criar `apps/api/entrypoint.sh`**

```bash
#!/bin/sh
set -e
echo "Aplicando migrations..."
node ./node_modules/prisma/build/index.js migrate deploy
exec "$@"
```

- [ ] **Step 2: Criar `apps/api/Dockerfile`**

```dockerfile
# ---- deps: instala o workspace completo (pnpm precisa dos symlinks entre apps) ----
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- build: compila a API e gera o Prisma Client ----
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# ---- runtime: só o necessário pra rodar, com Chromium de sistema pro Puppeteer ----
FROM node:22-alpine AS runtime
RUN corepack enable \
  && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter api
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/node_modules/.prisma node_modules/.prisma
COPY apps/api/entrypoint.sh apps/api/entrypoint.sh
RUN chmod +x apps/api/entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/app.js"]
```

- [ ] **Step 3: Buildar a imagem**

```bash
cd /home/max/job/autohubs/tramita
docker build -f apps/api/Dockerfile -t tramita-api:test .
```

Expected: build termina sem erro (vai demorar alguns minutos na primeira vez — baixa `node:22-alpine`, instala dependências, compila).

- [ ] **Step 4: Confirmar que o Chromium de sistema está instalado e executável**

```bash
docker run --rm tramita-api:test sh -c "chromium-browser --version"
```

Expected: imprime algo como `Chromium 1XX.0.0.0` (a versão exata depende do pacote `chromium` do repositório Alpine no momento do build — não precisa bater com nenhum valor fixo, só precisa executar sem erro).

- [ ] **Step 5: Subir o container conectado aos bancos locais e testar `/health`**

Os containers `client-requests-postgres-1`/`client-requests-redis-1` precisam estar rodando (`docker start client-requests-postgres-1 client-requests-redis-1` se não estiverem).

```bash
docker run --rm -d --name tramita-api-test \
  --network host \
  -e DATABASE_URL="postgresql://tramita:tramita@localhost:5432/tramita" \
  -e REDIS_URL="redis://localhost:6379" \
  -e PORT=3001 \
  -e JWT_PRIVATE_KEY="$(grep ^JWT_PRIVATE_KEY= /home/max/job/autohubs/tramita/.env | cut -d= -f2-)" \
  -e JWT_PUBLIC_KEY="$(grep ^JWT_PUBLIC_KEY= /home/max/job/autohubs/tramita/.env | cut -d= -f2-)" \
  -e ENCRYPTION_KEY="$(grep ^ENCRYPTION_KEY= /home/max/job/autohubs/tramita/.env | cut -d= -f2-)" \
  tramita-api:test
sleep 4
curl -s http://localhost:3001/health
docker logs tramita-api-test --tail 30
docker stop tramita-api-test
```

Expected: `curl` retorna `{"status":"ok"}`; os logs mostram `Aplicando migrations...` seguido de `No pending migrations to apply` (ou a aplicação de migrations pendentes, se houver) e depois o log do Fastify confirmando que o servidor está escutando — sem stack trace de erro.

(`--network host` só funciona em Docker Engine no Linux — é exatamente o ambiente desta máquina. Se o teste for rodado em Docker Desktop Mac/Windows, troque por publicar a porta com `-p 3001:3001` e ajuste `DATABASE_URL`/`REDIS_URL` para usar `host.docker.internal` no lugar de `localhost`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile apps/api/entrypoint.sh
git commit -m "feat(infra): adicionar Dockerfile multi-stage da API com Chromium de sistema"
```

---

## Task 5: `apps/web/Dockerfile` + `nginx.conf`

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`

**Interfaces:**
- Consumes: `pnpm --filter web build` (já funciona hoje, confirmado — Vite resolve os aliases internamente, sem o problema da Task 2).
- Produces: imagem Docker `tramita-web` servindo os arquivos estáticos na porta `80` via Nginx, com fallback de SPA.

- [ ] **Step 1: Criar `apps/web/nginx.conf`**

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 2: Criar `apps/web/Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter web build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: Buildar a imagem com o build arg de produção**

```bash
cd /home/max/job/autohubs/tramita
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://tramitaapi.autohubs.com.br \
  -t tramita-web:test .
```

Expected: build termina sem erro.

- [ ] **Step 4: Subir o container e confirmar que serve o SPA**

```bash
docker run --rm -d --name tramita-web-test -p 8081:80 tramita-web:test
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/app/dashboard
docker stop tramita-web-test
```

Expected: ambos os `curl` retornam `200` — a segunda chamada (`/app/dashboard`, uma rota de cliente do React Router que não existe como arquivo físico) confirma que o `try_files ... /index.html` do `nginx.conf` está funcionando como fallback de SPA.

- [ ] **Step 5: Confirmar que a variável `VITE_API_URL` foi de fato embutida no bundle**

```bash
docker run --rm tramita-web:test sh -c "grep -o 'tramitaapi.autohubs.com.br' /usr/share/nginx/html/assets/*.js | head -1"
```

Expected: imprime uma linha contendo `tramitaapi.autohubs.com.br` (confirma que o valor do build-arg foi assado no JS final pelo Vite, não só ficou disponível como variável de ambiente do processo de build).

- [ ] **Step 6: Commit**

```bash
git add apps/web/Dockerfile apps/web/nginx.conf
git commit -m "feat(infra): adicionar Dockerfile do web (Nginx + build estático) com fallback de SPA"
```

---

## Task 6: `.dockerignore` na raiz

**Files:**
- Create: `.dockerignore`

**Interfaces:**
- Nenhuma — só reduz o contexto enviado ao daemon Docker no `docker build`.

- [ ] **Step 1: Criar `.dockerignore` na raiz do repositório**

```
node_modules
**/node_modules
**/dist
.git
.env
.env.local
.env.*.local
*.pem
coverage
**/coverage
.nyc_output
.idea
*.swp
*.swo
.vite
.pnpm-store
apps/web/test-results
apps/web/playwright-report
.superpowers
.claude
docs
**/*.test.ts
**/*.test.tsx
```

- [ ] **Step 2: Rebuildar as duas imagens e confirmar que ainda funcionam (contexto menor não deve quebrar nada, já que `COPY . .` nos Dockerfiles das Tasks 3/4 só copia o que está fora do `.dockerignore`)**

```bash
cd /home/max/job/autohubs/tramita
docker build -f apps/api/Dockerfile -t tramita-api:test .
docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://tramitaapi.autohubs.com.br -t tramita-web:test .
```

Expected: ambos os builds passam sem erro (se algum deles falhar reclamando de arquivo faltante, é sinal de que esse arquivo é necessário no build e foi ignorado por engano — ajustar o `.dockerignore` removendo a entrada correspondente).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "feat(infra): adicionar .dockerignore na raiz"
```

---

## Task 7: `docker-compose.prod.yml`

**Files:**
- Create: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: `apps/api/Dockerfile` (Task 3), `apps/web/Dockerfile` (Task 4).
- Produces: arquivo de compose usado pelo Dokploy (tipo de aplicação "Docker Compose"), com 3 serviços (`api`, `worker`, `web`), labels Traefik, rede externa `dokploy-network`, sem portas publicadas.

- [ ] **Step 1: Criar `docker-compose.prod.yml`**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
      ASAAS_API_KEY: ${ASAAS_API_KEY}
      ASAAS_BASE_URL: ${ASAAS_BASE_URL}
      ASAAS_WEBHOOK_SECRET: ${ASAAS_WEBHOOK_SECRET}
      B2_KEY_ID: ${B2_KEY_ID}
      B2_APP_KEY: ${B2_APP_KEY}
      B2_BUCKET_NAME: ${B2_BUCKET_NAME}
      B2_BUCKET_REGION: ${B2_BUCKET_REGION}
      B2_ENDPOINT: ${B2_ENDPOINT}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      APP_URL: ${APP_URL}
      NODE_ENV: production
      PORT: 3000
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.http.routers.tramita-api.rule=Host(`tramitaapi.autohubs.com.br`)
      - traefik.http.routers.tramita-api.entrypoints=websecure
      - traefik.http.routers.tramita-api.tls.certresolver=letsencrypt
      - traefik.http.services.tramita-api.loadbalancer.server.port=3000
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      B2_KEY_ID: ${B2_KEY_ID}
      B2_APP_KEY: ${B2_APP_KEY}
      B2_BUCKET_NAME: ${B2_BUCKET_NAME}
      B2_BUCKET_REGION: ${B2_BUCKET_REGION}
      B2_ENDPOINT: ${B2_ENDPOINT}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      APP_URL: ${APP_URL}
      NODE_ENV: production
    networks:
      - dokploy-network
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        VITE_API_URL: https://tramitaapi.autohubs.com.br
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:80"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - dokploy-network
    labels:
      - traefik.enable=true
      - traefik.http.routers.tramita-web.rule=Host(`tramita.autohubs.com.br`)
      - traefik.http.routers.tramita-web.entrypoints=websecure
      - traefik.http.routers.tramita-web.tls.certresolver=letsencrypt
      - traefik.http.services.tramita-web.loadbalancer.server.port=80
    restart: unless-stopped

networks:
  dokploy-network:
    external: true
```

`worker` usa o **mesmo `command` override do compose** (`node dist/worker.js`) e por isso pula o `entrypoint.sh` de migration — espera, na verdade o `ENTRYPOINT` do Dockerfile (`./entrypoint.sh`) sempre roda primeiro independente do `command`, já que `command` só substitui o `CMD`, que é passado como argumento pro `ENTRYPOINT` (`exec "$@"` no `entrypoint.sh`). Isso significa que **o `worker` também roda `prisma migrate deploy` ao subir**, em paralelo com o `api`. Resolver isso na Task 7 (ver nota lá) — por ora, documentar o comportamento real do `ENTRYPOINT`/`CMD` aqui é o suficiente; a correção (se necessária) é avaliada com o teste de integração completo da Task 7.

- [ ] **Step 2: Validar a sintaxe do compose**

```bash
cd /home/max/job/autohubs/tramita
docker compose -f docker-compose.prod.yml config > /dev/null
echo "EXIT=$?"
```

Expected: `EXIT=0` (sem erro de parsing/sintaxe — não tenta efetivamente subir nada, já que a rede externa `dokploy-network` não existe nesta máquina).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(infra): adicionar docker-compose.prod.yml para deploy no Dokploy"
```

---

## Task 8: `docker-compose.local-test.yml` + validação de integração completa local

**Files:**
- Create: `docker-compose.local-test.yml`
- Modify: `docker-compose.prod.yml` (resolver a corrida de migration entre `api` e `worker` identificada na Task 6, se o teste desta task confirmar que ela causa problema real)

**Interfaces:**
- Consumes: `docker-compose.prod.yml` (Task 6) como base, mesclado via `-f`.

- [ ] **Step 1: Criar `docker-compose.local-test.yml`**

```yaml
services:
  api:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgresql://tramita:tramita@host.docker.internal:5432/tramita
      REDIS_URL: redis://host.docker.internal:6379
    ports:
      - "3000:3000"

  worker:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgresql://tramita:tramita@host.docker.internal:5432/tramita
      REDIS_URL: redis://host.docker.internal:6379

  web:
    ports:
      - "8080:80"

networks:
  dokploy-network:
    external: false
```

`extra_hosts: host.docker.internal:host-gateway` é necessário em Docker Engine no Linux (diferente do Docker Desktop Mac/Windows, onde `host.docker.internal` já funciona nativamente) — sem isso, os containers não conseguem alcançar o Postgres/Redis rodando no host.

- [ ] **Step 2: Confirmar que os bancos locais estão no ar**

```bash
docker start client-requests-postgres-1 client-requests-redis-1 2>/dev/null || true
docker ps --format "{{.Names}}" | grep -E "postgres-1$|redis-1$"
```

Expected: lista `client-requests-postgres-1` e `client-requests-redis-1` (ou os nomes equivalentes que estiverem ativos na máquina — ajuste se os containers tiverem outro nome).

- [ ] **Step 3: Exportar as variáveis de ambiente necessárias e subir o stack completo**

O Docker Compose carrega automaticamente um arquivo `.env` no diretório de execução para resolver `${VAR}` — o `.env` da raiz do repositório já tem `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `ENCRYPTION_KEY`, etc. preenchidos para uso local. `DATABASE_URL`/`REDIS_URL` desse mesmo arquivo são sobrescritos pelo `docker-compose.local-test.yml` (Step 1), então não precisam bater com os valores corretos para dentro do container.

```bash
cd /home/max/job/autohubs/tramita
docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml up --build -d
sleep 8
docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml ps
```

Expected: os 3 serviços (`api`, `worker`, `web`) aparecem com status `running` (ou `healthy`, depois do healthcheck rodar pela primeira vez).

- [ ] **Step 4: Testar a API e o web**

```bash
curl -s http://localhost:3000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/
```

Expected: `{"status":"ok"}` e `200`, respectivamente.

- [ ] **Step 5: Verificar os logs do `worker` e do `api` para a corrida de migration identificada na Task 6**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml logs api worker
```

Observar se ambos os logs mostram `Aplicando migrations...`. Se as migrations já estavam todas aplicadas (cenário normal de reiniciar um stack já deployado), `prisma migrate deploy` é idempotente e simplesmente reporta "No pending migrations to apply" nos dois containers, sem erro — nesse caso, **nenhuma correção é necessária**, e este passo só confirma que o comportamento documentado na Task 6 é seguro. Se, em vez disso, qualquer um dos dois logs mostrar um erro de lock/conflito de migration (corrida real), aplicar a correção do Step 6 abaixo.

- [ ] **Step 6 (só se o Step 5 revelar um erro real de corrida): remover o `ENTRYPOINT` de migration do `worker`**

Editar `docker-compose.prod.yml`, trocando o serviço `worker` para sobrescrever também o `entrypoint`, pulando o `entrypoint.sh`:

```yaml
  worker:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    entrypoint: []
    command: ["node", "dist/worker.js"]
```

(mantendo o restante do serviço `worker` como já está). Subir de novo (`docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml up --build -d`) e repetir o Step 5 até confirmar que só o `api` aplica migrations.

- [ ] **Step 7: Testar a geração de relatório PDF dentro do container (valida o Chromium de sistema em uso real, não só `--version`)**

Esse teste exige dados reais (org, cliente, board) — usar o seed já existente:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml exec api sh -c "node -e \"
const { PrismaClient } = require('@prisma/client');
\""
```

Na prática, validar isso manualmente é mais simples logando como `admin@g2a.com.br` / `G2A@Admin2025` (usuário do seed, já existente do trabalho anterior nesta sessão) no frontend apontando para `http://localhost:8080`, criando um board/cliente com pelo menos uma tarefa, e clicando no botão "Exportar relatório" — se o PDF for baixado sem erro 500, o Chromium de sistema dentro do container está funcionando para geração real de PDF. Documentar no relatório da task se esse passo manual foi ou não executado (ambiente sem browser disponível é uma limitação aceitável — declarar isso explicitamente em vez de presumir que funcionou).

- [ ] **Step 8: Derrubar o stack de teste**

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local-test.yml down
```

- [ ] **Step 9: Commit**

```bash
git add docker-compose.local-test.yml
git diff --cached --quiet docker-compose.prod.yml || git add docker-compose.prod.yml
git commit -m "feat(infra): adicionar docker-compose.local-test.yml para validar as imagens de produção localmente"
```

(O `git add docker-compose.prod.yml` só entra no commit se o Step 6 tiver sido necessário e tiver alterado esse arquivo — o `git diff --cached --quiet || git add` cobre os dois casos sem duplicar o commit caso não haja mudança nele.)

---

## Task 9: Documentação — `.env.example` e `docs/TASKS.md`

**Files:**
- Modify: `.env.example`
- Modify: `docs/TASKS.md`

**Interfaces:**
- Nenhuma — só documentação.

- [ ] **Step 1: Adicionar nota sobre `VITE_API_URL` ser variável de build, não de runtime**

Em `.env.example`, adicionar ao final do arquivo (depois da seção `# Encryption`):

```
# Frontend (build-time apenas — o Vite assa essa variável no bundle estático
# em tempo de `vite build`; trocar depois exige rebuildar a imagem do web,
# não basta reiniciar o container)
VITE_API_URL=http://localhost:3000
```

- [ ] **Step 2: Marcar os itens da Fase 9 implementados em `docs/TASKS.md`**

Localizar a seção `## Fase 9 — Infra e Deploy` em `docs/TASKS.md` e marcar como concluídos (`- [x]`) os itens que este plano efetivamente entrega:

```
- [ ] `docker-compose.yml`: api, web, postgres, redis, puppeteer
- [ ] Dockerfiles multi-stage (api + web)
- [ ] `.env.example` completo
- [ ] Dokploy + Traefik
  - [ ] `tramita.autohubs.com.br` → web (todas as rotas: landing, /login, /master, /app, /portal)
  - [ ] `api.tramita.autohubs.com.br` → api Fastify
  - [ ] TLS automático (Let's Encrypt via Traefik)
- [ ] Healthchecks nos containers
```

passam a:

```
- [x] `docker-compose.prod.yml`: api, web, worker (puppeteer embutido na imagem da api; postgres/redis já existem no Dokploy)
- [x] Dockerfiles multi-stage (api + web)
- [x] `.env.example` completo
- [x] Dokploy + Traefik
  - [x] `tramita.autohubs.com.br` → web (todas as rotas: landing, /login, /master, /app, /portal)
  - [x] `tramitaapi.autohubs.com.br` → api Fastify
  - [x] TLS automático (Let's Encrypt via Traefik, gerenciado pelo Dokploy)
- [x] Healthchecks nos containers
```

(Note a correção do domínio de `api.tramita.autohubs.com.br` para `tramitaapi.autohubs.com.br`, conforme decidido nesta rodada — mantém o `TASKS.md` consistente com o spec e o compose reais.)

Os dois itens restantes da Fase 9 (`docker compose up + pnpm test` em CI, e o item de CI/CD do GitHub Actions mencionado na seção de testes) ficam fora do escopo deste plano — não marcar.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/TASKS.md
git commit -m "docs: atualizar .env.example e TASKS.md com o status real da Fase 9"
```

---

## Self-Review

- **Cobertura do spec:** todas as 5 seções do spec (`Dockerfile` da api, `Dockerfile` do web, `docker-compose.prod.yml`, override de teste local, arquivos auxiliares) têm task correspondente (Tasks 4, 5, 7, 8, 6/9).
- **Gap encontrado e adicionado ao plano (em duas rodadas):** o spec não previa que o build (`tsc`) e o boot de runtime (`node dist/app.js`) da API estavam **realmente quebrados** hoje. Task 1 corrige o `rootDir`; ao validar o build depois dela, apareceram 345 erros de `moduleResolution` mascarando 11 erros de tipo reais — Task 2 corrige ambos; Task 3 corrige a reescrita de aliases em runtime. Sem as três, a Task 4 (`Dockerfile` da API) buildaria uma imagem que nunca inicializa (ou cujo `RUN pnpm --filter api build` falharia direto no `docker build`).
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — toda task tem comandos exatos e saída esperada.
- **Consistência de nomes:** `tramitaapi.autohubs.com.br` usado de forma consistente nas Tasks 4, 5, 7, 9 (conferido contra a correção de domínio pedida pelo usuário no spec).
- **Fora de escopo (igual ao spec):** microserviço de Puppeteer, domínio único com proxy de path, CI/CD via GitHub Actions, self-host de Postgres/Redis em container.
