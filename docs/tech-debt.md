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

## Cobertura de testes da API abaixo do threshold configurado (80%) ✅ (resolvido em 2026-09-20)

**Contexto original:** `apps/api/vitest.config.ts` já define `coverage.thresholds: { lines: 80, functions: 80 }`, mas a cobertura real estava em 71.73% (linhas) e 68.05% (funções) — `pnpm --filter api test:coverage` falhava com `ERROR: Coverage ... does not meet global threshold`. O job de CI rodava `pnpm --filter api test` (sem `--coverage`), sem bloquear por esse threshold.

**Resolvido:** escritos testes de borda (casos de falha, isolamento por organização, não apenas caminho feliz) para os services de lógica de negócio mais fracos, sem tocar em rotas/controllers simples (política deste projeto):
- `modules/dashboard/dashboard.service.ts` — 0.8% → 98.52% (não tinha nenhum teste; agregação de KPIs, detecção de atraso, ordenação de `atRisk`)
- `modules/clients/clients.service.ts` — 21.95% → cobertura completa dos fluxos de CRUD, e-mail duplicado por organização, `setAssignments`/`listAssignments`
- `modules/columns/columns.service.ts` — 6.25% → cobertura completa de CRUD + isolamento por organização
- `modules/users/users.service.ts` — 36% → cobertura de `createUser`, `updateUser`, `deleteUser`, `getMyProfile`, `updateMyProfile` (antes só `resetUserPassword` era testado)
- `modules/tasks/tasks.service.ts` — 61% → cobertura de `createTask`, `updateTask` (histórico condicional), `reorderTasks`, `deleteTask`, `getTaskHistory` (antes só `moveTask` era testado)

Cobertura global final: 82.76% linhas / 78.09% branches / 81.25% funções (248 testes, 35 arquivos). `pnpm --filter api test:coverage` passa com exit 0. `.github/workflows/ci.yml` voltou a rodar `test:coverage` (enforcement reativado).

## `TaskDrawer` não atualiza o próprio título após salvar edição inline (encontrado em 2026-09-20)

**Contexto:** ao editar o título de uma tarefa pelo `TaskDrawer` (`apps/web/src/components/shared/TaskDrawer.tsx`) — clicar no `<h2>`, editar o `<input>` inline, `Enter`/blur dispara `updateMutation.mutate({ title })` — a mutação persiste corretamente e o card da tarefa na coluna do Kanban atualiza (a query do board é invalidada e refaz o fetch), mas o próprio `<h2>` dentro do drawer continua mostrando o título antigo até o drawer ser fechado e reaberto. Encontrado depurando `apps/web/e2e/flows/org-board.spec.ts` — o teste de edição de título precisou verificar o card no Kanban em vez do heading do drawer por causa disso (ver comentário no teste).

**Pendente:** investigar se o `task` exibido no `TaskDrawer` vem de uma referência memorizada no componente pai (ex.: `useState` setado só no clique de abrir, nunca ressincronizado com o resultado da query do board) em vez de derivado ao vivo da query por id — se for isso, o fix é passar/derivar o `task` atualizado do cache do react-query em vez de um snapshot fixo.

## Migration `20260920160000_add_departments` assume `client_assignments` vazia (encontrado em 2026-09-20)

**Contexto:** essa migration foi escrita à mão (o CLI do Prisma recusa migrations destrutivas não-interativas) e adiciona `client_assignments.departmentId` como `NOT NULL` sem `DEFAULT`. Isso só é seguro porque a tabela foi verificada vazia em dev/test antes da migration rodar — o arquivo agora tem um comentário de aviso no topo (`apps/api/prisma/migrations/20260920160000_add_departments/migration.sql`).

**Pendente:** se este repositório for implantado em um ambiente com dados reais em `client_assignments` antes de uma reescrita, a migration falhará. Nesse caso, ela precisa ser reescrita com um passo de backfill de `departmentId` antes de adicionar a constraint `NOT NULL`.

## Departamentos — itens parqueados na revisão de 2026-09-20

**Contexto:** revisão de branch completa do feature de Departamentos (responsabilidade por departamento) encontrou dois itens Medium considerados de baixo risco no volume atual de dados, parqueados deliberadamente em vez de corrigidos junto com os Important:

- Falta `@@index([departmentId])` em `Task` e `Request` no `schema.prisma` — sem problema no volume de dados atual; revisitar se queries filtradas por departamento aparecerem em logs de slow query.
- `updateTask` em `tasks.service.ts` não grava uma entrada de `TaskHistory` quando `departmentId` muda (diferente de `priority`/`assigneeId`) — decisão explícita e revisada para esta fase (2a); estender quando o item 2c/2d do roadmap (motor de recorrência / modelo de status expandido) tocar essa função novamente.

## `createTask` cai num departamento "Geral" auto-criado quando nenhum é informado (encontrado em 2026-09-21, feature de usuários de cliente por departamento)

**Contexto:** a migration `20260921210100_task_department_required` tornou `Task.departmentId` obrigatório no schema. Hoje isso só é exercitado sem `departmentId` explícito por um caminho: `requests.service.ts`'s `approveRequest` cria a `Task` a partir de uma `Request` que pode ter sido aberta sem `departmentId` (esse campo continua opcional em `Request`). Para não quebrar esse fluxo nem inventar uma UX de seleção obrigatória de departamento no momento (fora do escopo da Task 1 do plano de usuários de cliente por departamento), `tasks.service.ts`'s `defaultDepartmentForOrg` busca o primeiro departamento da organização e, se não existir nenhum, cria um chamado "Geral" e usa esse.

**Pendente:** a Task 6 do mesmo plano ("Task.departmentId required end-to-end") deve fechar isso corretamente fazendo `approveRequest` herdar o `departmentId` da própria `Request` de origem quando presente, caindo no fallback "Geral" auto-criado somente quando a request também não tiver departamento definido.
