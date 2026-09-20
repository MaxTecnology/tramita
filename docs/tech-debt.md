# Débito Técnico — Tramita

## Mocking de dependências externas em testes — padronizado em `vi.spyOn` ✅ (resolvido em 2026-09-20)

**Contexto original:** `apps/api/src/test/setup.ts` cria uma única instância `buildApp()` no carregamento do módulo, antes que os `vi.mock(module, factory)` de cada arquivo de teste tenham chance de fazer hoist. Quando uma rota nova passa a importar de verdade um service que outro arquivo de teste mockava via `vi.mock(...)`, o app compartilhado já capturou o binding real, e o `vi.mock` do outro arquivo deixa de interceptar — causando chamadas reais (rede, fila) vazarem em testes que pareciam isolados.

**Resolvido:** todos os arquivos de teste que mockavam dependências externas via `vi.mock(module, factory)` foram convertidos para `vi.spyOn(namespaceImport, 'fn')` em `beforeEach`/`afterEach`:
- `attachments.service.test.ts`, `requests.service.test.ts`, `request-attachments.service.test.ts` (já corrigidos anteriormente)
- `maximizebot.test.ts` — `vi.spyOn(axios, 'post')`
- `mailer.test.ts` — `vi.spyOn(Resend.prototype, 'post')` (seam de rede real do SDK `resend`, já que a classe `Emails` não é exportada)
- `notification-worker.test.ts` — `vi.spyOn` em `maximizebot`, `mailer` e `encryption`
- `organizations.service.test.ts` — `vi.spyOn(asaas, ...)` (não estava listado originalmente, mas seguia o mesmo padrão frágil)

Nenhum arquivo de teste em `apps/api/src` usa mais `vi.mock(module, factory)` para dependência externa.

## `tsc-alias --resolve-full-paths` depende de `moduleResolution: "bundler"` ficar como está

**Contexto:** `apps/api/tsconfig.json` usa `"moduleResolution": "bundler"`, então o `tsc` emite imports relativos sem extensão (`./server`, não `./server.js`) — o Node ESM nativo exige extensão explícita em specifiers relativos, então o build de produção usa `tsc-alias --resolve-full-paths` (em `apps/api/package.json#scripts.build`) pra completar a extensão `.js` depois da reescrita dos aliases `@/`.

**Pendente (não é uma ação urgente, só uma nota pra quem tocar isso no futuro):** se o `moduleResolution` da API for trocado pra `NodeNext`/`Node16` (mais correto para ESM puro), os `import` statements em `src/` passariam a exigir extensão `.js` explícita no próprio código-fonte (regra do NodeNext), e a flag `--resolve-full-paths` deixaria de ser necessária — mas não seria prejudicial mantê-la mesmo assim.

## Cobertura de testes da API abaixo do threshold configurado (80%)

**Contexto:** `apps/api/vitest.config.ts` já define `coverage.thresholds: { lines: 80, functions: 80 }`, mas a cobertura real hoje é 71.73% (linhas) e 68.05% (funções) — `pnpm --filter api test:coverage` falha com `ERROR: Coverage ... does not meet global threshold`. Por isso o job de CI roda `pnpm --filter api test` (sem `--coverage`), sem bloquear por esse threshold por enquanto.

**Onde a cobertura está mais baixa (lógica de negócio, não rotas simples):**
- `modules/users/users.service.ts` — 36% (geração de senha temporária, CRUD de usuários internos)
- `modules/organizations/organizations.service.ts` — 55% (vínculo com Asaas, criação manual pelo Master, rollback em falha)
- `modules/tasks/tasks.service.ts` — 61% (movimentação, histórico automático)
- `modules/portal/portal.routes.ts` — 65% (mistura rota simples com alguma lógica de acesso do cliente)

**Pendente:** escrever testes de borda para os services acima (não para rotas/controllers simples, seguindo a política deste projeto de só testar lógica crítica de negócio), até a cobertura real passar de 80%, e então trocar `test` por `test:coverage` de volta no `.github/workflows/ci.yml`.
