# Design — Remover feature de relatório PDF (Puppeteer/Chromium)

## Objetivo

Remover completamente a geração de relatório PDF (backend + frontend),
descoberta durante a Task 4 do plano de deploy (`docker-deploy-plan.md`) como
a principal responsável pelo tamanho da imagem Docker da API (Chromium +
libs de sistema). A decisão do usuário é remover agora e reimplementar mais
tarde com uma abordagem mais leve — esta entrega só cobre a remoção, não a
reimplementação.

## Decisões confirmadas com o usuário

- A aba "Relatórios" no portal do cliente é removida totalmente (sem
  placeholder "em breve").
- O botão "Exportar relatório" no Dashboard do escritório é removido
  totalmente (sem desabilitar/manter visível).
- Documentação existente que menciona a feature (`TASKS.md`, `ARCHITECTURE.md`,
  `SPEC.md`) recebe uma nota explicando a remoção e o motivo — não é apagada
  como se nunca tivesse existido.

## Backend

- Deletar o diretório `apps/api/src/modules/reports/` por completo:
  - `reports.routes.ts`
  - `reports.service.ts`
  - `reports.service.test.ts`
- Em `apps/api/src/server.ts`, remover a linha de import
  `import { reportsRoutes } from '@/modules/reports/reports.routes'` e a
  linha de registro `app.register(reportsRoutes)`.
- Em `apps/api/package.json`, remover `"puppeteer": "^25.1.0"` das
  `dependencies` (única consumidora da lib em todo o monorepo — confirmado
  por busca: `grep -rn "puppeteer" apps/api/src` só retorna
  `reports.service.ts`). Rodar `pnpm install` na raiz pra atualizar o
  `pnpm-lock.yaml`.

## Frontend

- Deletar `apps/web/src/pages/portal/Reports.tsx`.
- Em `apps/web/src/router.tsx`: remover a linha
  `const PortalReports = lazy(() => import('@/pages/portal/Reports'))` e a
  rota filha `{ path: 'reports', element: <PortalReports /> }` dentro do
  bloco `/portal`.
- Em `apps/web/src/pages/portal/Layout.tsx`: remover a entrada
  `{ to: '/portal/reports', icon: FileText, label: 'Relatórios' }` do array
  `tabs` (conferir se o import do ícone `FileText` fica sem outro uso no
  arquivo — se sim, remover o import também).
- Em `apps/web/src/pages/app/Dashboard.tsx`: remover a função
  `handleExportReport` (linhas ~60-73) e o `<button>` "Exportar relatório"
  dentro do `<CardContent>` de cada board (dentro do `.map`).

## Docker

- Em `apps/api/Dockerfile` (já existente, da Task 4 do plano de deploy):
  remover do `runtime` stage:
  - `apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont`
    (volta a ser só `corepack enable` nesse `RUN`)
  - As 3 variáveis de ambiente do Puppeteer (`PUPPETEER_SKIP_DOWNLOAD`,
    `PUPPETEER_EXECUTABLE_PATH`) — mantém `NODE_ENV=production`.
- Rebuildar a imagem (`docker build -f apps/api/Dockerfile -t tramita-api:test .`)
  e confirmar que ainda sobe e responde `/health` — sem Chromium, a imagem
  deve ficar consideravelmente menor (Chromium + libs representavam a maior
  parte dos ~1.4GB anteriores).

## Documentação

- `docs/TASKS.md`: na Fase 8d (`Relatório PDF`), manter os itens já marcados
  como `[x]` (foram feitos), mas adicionar uma nota abaixo da seção:
  > **Nota (2026-06-28):** feature removida — o Chromium necessário pro
  > Puppeteer inflava demais a imagem Docker da API. Reimplementação
  > planejada com abordagem mais leve (sem browser headless completo).
- `docs/ARCHITECTURE.md`: localizar a menção de Puppeteer/relatório PDF e
  adicionar nota equivalente, sem remover o texto original.
- `docs/SPEC.md`: localizar a documentação do endpoint
  `GET /clients/:clientId/report` e adicionar a mesma nota.
- `docs/tech-debt.md`: remover a entrada "XSS no PDF de relatórios —
  `buildReportHtml` não escapa dados do usuário" — deixa de ser débito
  técnico relevante porque a função inteira é deletada.

## Testes

- `reports.service.test.ts` é deletado junto com o módulo — sem teste
  substituto, já que não há mais código pra testar.
- Rodar `pnpm --filter api test` após a remoção e confirmar que a suíte
  passa com a contagem de testes reduzida pelo número de testes que
  existiam em `reports.service.test.ts` (a baseline antes desta remoção:
  177 testes — confirmar quantos desses pertencem a `reports.service.test.ts`
  durante a implementação, pra saber o número exato esperado depois).
- Rodar `pnpm --filter web test` e confirmar que nenhum teste referenciava
  `PortalReports`/`handleExportReport` (verificação rápida, não esperado
  encontrar nada já que não há teste de página dedicado a isso hoje).

## Fora do escopo

- Reimplementação de relatórios com qualquer abordagem mais leve — fica
  para uma sessão futura, com seu próprio brainstorming/spec quando o
  usuário decidir a abordagem (ex: lib de PDF sem browser, serviço externo,
  etc.).
- Qualquer ajuste no restante do plano de deploy do Docker alheio ao
  Dockerfile da API (compose de produção, override de teste local, etc. —
  tratado separadamente, retomando o `docker-deploy-plan.md` depois desta
  remoção).
