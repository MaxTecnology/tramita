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

## `TaskDrawer` não atualiza o próprio título após salvar edição inline ✅ (resolvido em 2026-10-05)

**Contexto original:** ao editar o título de uma tarefa pelo `TaskDrawer` — clicar no `<h2>`, editar o `<input>` inline, `Enter`/blur dispara `updateMutation.mutate({ title })` — a mutação persistia corretamente e o card na coluna do Kanban atualizava, mas o próprio `<h2>` dentro do drawer continuava mostrando o título antigo até fechar/reabrir. Encontrado depurando `apps/web/e2e/flows/org-board.spec.ts`.

**Resolvido:** a suspeita original era exatamente a causa — `Board.tsx` guardava o objeto `Task` inteiro num `useState` setado só no clique (`selectedTask`), nunca ressincronizado com o resultado da query do board depois de uma mutação. Trocado por `selectedTaskId: string | null` + derivação ao vivo (`board?.columns.flatMap(c => c.tasks).find(t => t.id === selectedTaskId)`) a cada render, assim o objeto passado pro `TaskDrawer` sempre reflete os dados mais recentes da query.

`apps/web/src/pages/app/Tasks.tsx` (tela nova de Kanban dinâmico, Task 7 do redesenho de Kanban) tinha o mesmo padrão com a mesma causa — corrigido do mesmo jeito, derivando de `tasks.find(...)` em vez de guardar o objeto. Achado um segundo bug relacionado nesse processo: `TaskDrawer`'s `updateMutation.onSuccess` só invalidava `queryKey: ['board']`, nunca `['tasks']` — então editar uma tarefa pela tela nova não atualizava a lista/kanban daquela tela de forma alguma (não só o drawer), até um refresh manual. Corrigido invalidando os dois query keys sempre, já que o componente agora é usado nos dois contextos.

Teste E2E (`org-board.spec.ts`) atualizado pra afirmar diretamente no heading do drawer em vez de só no card do Kanban, já que agora os dois refletem a edição. 8/8 specs Playwright passando.

## Migration `20260920160000_add_departments` assume `client_assignments` vazia (encontrado em 2026-09-20)

**Contexto:** essa migration foi escrita à mão (o CLI do Prisma recusa migrations destrutivas não-interativas) e adiciona `client_assignments.departmentId` como `NOT NULL` sem `DEFAULT`. Isso só é seguro porque a tabela foi verificada vazia em dev/test antes da migration rodar — o arquivo agora tem um comentário de aviso no topo (`apps/api/prisma/migrations/20260920160000_add_departments/migration.sql`).

**Pendente:** se este repositório for implantado em um ambiente com dados reais em `client_assignments` antes de uma reescrita, a migration falhará. Nesse caso, ela precisa ser reescrita com um passo de backfill de `departmentId` antes de adicionar a constraint `NOT NULL`.

## Departamentos — itens parqueados na revisão de 2026-09-20 ✅ (resolvidos em 2026-10-05)

**Contexto original:** revisão de branch completa do feature de Departamentos encontrou dois itens Medium considerados de baixo risco no volume atual de dados, parqueados deliberadamente em vez de corrigidos junto com os Important.

**Resolvidos:**
- `@@index([departmentId])` adicionado em `Task` e `Request` (`schema.prisma` + migration `20261005200000_task_request_department_indexes`), aplicada em dev e teste.
- `updateTask` em `tasks.service.ts` agora grava `TaskHistory` (action `department_changed`, `fromValue`/`toValue` = ids dos departamentos) quando `departmentId` muda, só quando o valor muda de verdade — mesmo padrão já usado por `priority_changed`/`assigned_to`. Label `department_changed` adicionado em `TaskDrawer.tsx`'s `ACTION_LABELS`. Teste adicionado confirmando o registro único (não duplica em updates repetidos com o mesmo valor).

## `approveRequest` cai num departamento "Geral" auto-criado quando a Request de origem não tem departamento ✅ (design final, fechado em 2026-09-21)

**Contexto:** a migration `20260921210100_task_department_required` tornou `Task.departmentId` obrigatório no schema, e a Task 6 do plano de usuários de cliente por departamento removeu o `.optional()` de `createTaskSchema.departmentId` — todo chamador de `createTask` agora precisa fornecer um `departmentId` real. `Request.departmentId` continua opcional (o cliente final pode abrir uma solicitação sem escolher departamento), então `requests.service.ts`'s `approveRequest` é o único lugar que ainda precisa de um fallback: ele herda o `departmentId` da própria `Request` quando presente e, quando não, resolve explicitamente via `defaultDepartmentForOrg` (agora exportado de `tasks.service.ts`) *antes* de chamar `createTask`, passando sempre uma string real.

**Este não é mais um débito interino:** o fallback "Geral" auto-criado é o design definitivo para o caso de borda "Request aprovada sem departamento definido" — não uma gambiarra temporária. `defaultDepartmentForOrg` deixou de ser chamado de dentro de `createTask` (onde era código morto, já que todo chamador agora fornece um valor real por construção) e passou a ser responsabilidade exclusiva de `approveRequest`, o único caller que legitimamente pode receber um `departmentId` ausente.

## `GET /tasks` sem paginação ✅ (resolvido com cursor completo em 2026-10-05)

**Contexto original:** o endpoint `listTasks`/`GET /tasks` (`apps/api/src/modules/tasks/tasks.service.ts`), que alimenta a tela "Tarefas" (lista + kanban dinâmico), retornava toda tarefa da organização de uma vez quando nenhum filtro era aplicado — sem `take`/cursor, sem limite de página. Mitigado em 2026-09-24 com um `limit` fixo (sem cursor real).

**Resolvido por completo:** `listTasks` agora pagina por cursor de verdade — `orderBy: [{ targetDate: 'asc' }, { id: 'asc' }]` (`id` como critério secundário pra garantir ordem total estável, já que `targetDate` não é único/pode ser null), busca `limit + 1` linhas pra saber se há próxima página sem uma segunda query, e retorna `{ items, nextCursor }` em vez de um array solto — **mudança de contrato da resposta**, não só um parâmetro novo. Schema ganhou `cursor: z.string().cuid().optional()`.

Frontend (`Tasks.tsx`) migrado de `useQuery` pra `useInfiniteQuery` (`@tanstack/react-query` v5), com botão "Carregar mais" que chama `fetchNextPage()` — visível em ambos os modos (Lista e Kanban), já que os dois derivam do mesmo array acumulado de páginas.

Testes atualizados pra ler `.items`/`.nextCursor` em vez do array direto, mais um teste novo que percorre todas as páginas com `limit=2` e confirma que nenhuma tarefa é pulada ou repetida. Suíte completa (423 testes API / 11 web / 8 E2E) verde depois da mudança de contrato.

## `GET /portal/tasks` não filtra `board.isActive` ✅ (resolvido em 2026-09-24)

**Contexto original:** o novo `listPortalTasks` (`apps/api/src/modules/portal/portal.service.ts`) não filtrava tarefas cujo board pai está com `isActive: false` (soft-deletado) — mesma lacuna existia em `getTaskHistory`, no mesmo arquivo.

**Resolvido:** `board: { isActive: true }` adicionado ao `where` de ambas as funções (`listPortalTasks` e `getTaskHistory`). Testes adicionados em `portal.routes.test.ts` confirmando 404/exclusão pra tarefa de board arquivado.

## Rótulo do status `BLOCKED` inconsistente na UI ✅ (resolvido em 2026-09-24)

**Contexto original:** o mesmo valor de enum `BLOCKED` aparecia como "Bloqueado" em `OSTemplateForm.tsx` e como "Com Impedimento" no resto da UI (`TaskDrawer`/`Tasks.tsx`).

**Resolvido:** padronizado para "Com Impedimento" em `OSTemplateForm.tsx`.

## Não é possível limpar campo opcional de volta pra vazio em formulários de edição ✅ (resolvido em 2026-09-24)

**Contexto original:** vários formulários de edição (cliente `notes`/`phone`/`codigo`/endereço, usuário `phone`, usuário de cliente `phone`, template de OS `description`) enviavam `campo: form.campo || undefined` no payload de PATCH — quando o usuário apagava o conteúdo de um campo opcional, `undefined` era omitido do JSON e o Prisma tratava isso como "não mexer no valor", então o campo nunca era limpo de volta pra `null` no banco.

**Resolvido:** padrão único aplicado em todos os pontos afetados — schemas Zod de **update** (não de create, que não precisa limpar nada) passaram a aceitar `.nullable().optional()` nos campos opcionais, e os payloads de edição do frontend passaram a enviar `campo: form.campo || null` em vez de `|| undefined`:
- `clients.schema.ts` (`updateClientSchema`) + `Clients.tsx` — `codigo`, `cnpj`, `cpf`, `whatsapp`, `phone`, `notes`, todos os campos de endereço
- `users.schema.ts` (`updateUserSchema`, `updateMyProfileSchema`) + `Users.tsx`/`Profile.tsx` — `phone`
- `client-users.schema.ts` (`updateClientUserSchema`) + `ClientUserForm.tsx` — `phone` (payload de create/edit foi separado, já que o schema de create continua exigindo `undefined`, não `null`)
- `os-templates.schema.ts` (`updateOSTemplateSchema`) + `OSTemplateForm.tsx` — `description` (mesma separação create/edit)

## Helpers de teste geravam nome/e-mail único só com `Date.now()` ✅ (resolvido em 2026-09-25)

**Contexto original:** `createTestDepartment`, `createTestUser` e `createTestClientUser` (`apps/api/src/test/helpers.ts`) usavam só `Date.now()` (granularidade de milissegundo) pra gerar nome/e-mail único — duas chamadas na mesma organização no mesmo milissegundo colidiam com `@@unique([organizationId, name])` (Department) ou e-mail único, muito mais provável sob o runner do CI (cobertura de código, timing diferente) do que localmente. Isso derrubava o job `test` do CI de forma intermitente.

**Resolvido:** aplicado o mesmo padrão `Date.now()-contador` que `createTestOrg` já usava nos três helpers. Confirmado verde no CI depois (`gh run watch`).

**Residual, baixo risco:** `createTestOrg`'s org "autohubs"/usuário "master" (linhas 98-108 do mesmo arquivo) ainda usam `Date.now()` puro, sem contador — mas são seeds chamados no máximo uma vez por arquivo de teste hoje, então o risco de colisão é baixo. Revisitar se algum teste futuro passar a chamá-los mais de uma vez na mesma execução.

## `e2e-seed.ts` desatualizado em relação a duas migrations ✅ (resolvido em 2026-09-25)

**Contexto original:** o seed usado pelos testes Playwright E2E (`apps/api/prisma/e2e-seed.ts`) ainda criava `Client` com `email`/`passwordHash` (removidos pela migration `20260921210000_client_users`, que introduziu `ClientUser` como entidade de login do portal) e colunas de board com `isFinal` (removido pela migration `20260922100000_kanban_os_foundation`, substituído por `statusEffect`). O job `e2e` do CI falhava direto no seed, antes de qualquer teste rodar.

**Resolvido:** seed reescrito pra criar um `Department` "Geral", um `ClientUser` com as credenciais que os specs Playwright já esperavam, e um `ClientUserAccess` ligando cliente+departamento — replicando o fluxo real de login do portal. Testado localmente (seed roda 2x seguidas sem erro, 8/8 specs Playwright passam) e confirmado verde no CI.
Todos os `services` correspondentes já espalhavam o body do Zod direto no `data` do `prisma.update`, então nenhuma mudança de lógica de service foi necessária — só o tipo do schema e o valor enviado pelo frontend. Teste adicionado em `clients.service.test.ts` confirmando que `codigo`/`notes` voltam a `null` quando enviados explicitamente como `null`. Suítes completas (API 421 testes, web 11 testes) passando.
