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

## Eventos de notificação sem controle completo na UI ✅ (resolvido em 2026-10-08)

**Contexto:** `recurringGenerationFailed` e `documentRejected` existem em `NotificationConfig` (com
default `true`) e o worker já os usa via `EVENT_FLAG_MAP`, mas nenhum dos dois tem toggle na tela de
Configurações nem entrada em `updateConfigSchema` — ficam travados ligados pra sempre, sem o
escritório poder desligar. `Templates.tsx`'s `EVENTS` também não cobre esses dois nem
`REQUEST_CREATED`/`REQUEST_APPROVED`/`REQUEST_REJECTED` — cinco eventos sem editor de mensagem
customizada, só o template padrão do sistema.

**Resolvido:**
- `notifications.schema.ts` — `recurringGenerationFailed`/`documentRejected` adicionados ao
  `updateConfigSchema` (os outros 9 campos já estavam lá, inclusive `taskCreated`/
  `requestCreated`/`requestApproved`/`requestRejected`, que tinham schema mas faltava UI).
- `notifications.service.ts` — `getConfig`'s `select` explícito ganhou os dois campos (sem isso o
  GET nunca devolveria o valor salvo, mesmo com o schema aceitando o PATCH).
- `Notifications.tsx` — 3 novas seções ("Tarefas", "Solicitações", "Tarefas recorrentes") cobrindo
  os 6 toggles que faltavam (`taskCreated`, `requestCreated`, `requestApproved`, `requestRejected`,
  `recurringGenerationFailed`, `documentRejected`), mais os 5 eventos novos no mapa de rótulos da
  aba de histórico.
- `Templates.tsx` — os 11 eventos de `NotificationEvent` agora aparecem no seletor do editor de
  mensagem (antes só 6). `DEFAULT_TEMPLATES` (`apps/api/src/lib/default-templates.ts`) já cobria
  os 11 de antes — zero mudança de backend necessária aí, só destravar a UI que escondia 5 deles.
- Teste novo em `notifications.routes.test.ts` confirmando round-trip PATCH→GET dos dois campos
  que faltavam no schema.

## `notification.worker.ts` não filtra o envio de WhatsApp por `task.visibleToClient` ✅ (resolvido em 2026-10-08)

**Contexto:** o branch de envio de email do worker (`apps/api/src/workers/notification.worker.ts`) já
pula o envio quando `task.visibleToClient === false` (tarefa marcada como controle interno, nunca
visível no portal), mas o branch de WhatsApp não tem essa checagem — manda a mensagem pro cliente
mesmo quando a tarefa referenciada não existe pra ele no portal. Isso é pré-existente a este feature
(afeta `TASK_CREATED`, `TASK_MOVED`, `TASK_COMPLETED`, `DOCUMENT_REJECTED`, etc. — qualquer evento com
`taskId`), não foi introduzido por ele.

`notifyIfBlocked` (`apps/api/src/modules/task-documents/task-documents.service.ts`), ponto único de
disparo do evento `TASK_BLOCKED` deste feature, recebeu a correção **só pro próprio evento**: checa
`visibleToClient` antes de enfileirar, já que `TASK_BLOCKED` vem ligado por padrão e sua mensagem
manda o cliente checar o portal por uma tarefa que ele pode não conseguir ver lá.

**Resolvido:** branch de WhatsApp em `notification.worker.ts` ganhou o mesmo
`if (task && !task.visibleToClient) continue` do branch de email, cobrindo todos os eventos com
`taskId`. Comentário de `notifyIfBlocked` atualizado pra deixar claro que agora são duas camadas
(enqueue-level pra `TASK_BLOCKED` + worker-level pros demais), não mais um gap conhecido. Testes
novos em `notification.worker.test.ts` confirmando que WhatsApp some pra `visibleToClient=false` e
continua mandando normal pra `visibleToClient=true`.

## Lacunas de UX aceitas no redesenho de geração recorrente ✅ (resolvidas em 2026-10-08)

**Contexto original:** a revisão final do redesenho vencimento-como-âncora (item 2f do roadmap)
achou 4 desvios entre a spec e o que foi de fato implementado:

1. Tela do template não mostrava status por cliente no mês selecionado.
2. Console global não tinha "Gerar novamente" por linha nas falhas pendentes, só link pro template.
3. Seletor de mês de vencimento usava o mês atual como default, não o "próximo ciclo normal".
4. Form de template não tinha preview calculado do vencimento/competência resultante.

**Resolvido:**
1. `RecurringTemplateManage.tsx` — cada linha de cliente mostra um badge (Pendente/Gerado/Falhou)
   calculado a partir do `log` daquele cliente pra competência correspondente ao mês selecionado
   (`computeCompetenceForDueMonth`, espelho client-side de `computeCompetenceFromDueMonth`).
2. `RecurringGenerationConsole.tsx` — banner de falhas agora lista cada falha com seu próprio botão
   "Gerar novamente" (busca os assignments do template sob demanda, já que a tela cruza vários
   templates e não pré-carrega vínculos de todos).
3. Ambas as telas (`RecurringTemplateManage.tsx`) inicializam o seletor com
   `computeNextDueMonthClient` (espelho de `computeNextDueMonth` do backend) assim que o template
   carrega, via `useRef` pra nunca resetar a escolha do operador em refetches seguintes. O console
   global continua usando o mês atual como default — ele cruza templates com ciclos diferentes,
   não existe um "próximo ciclo" único pra todos, decisão mantida da spec original.
4. `RecurringTemplateForm.tsx` ganhou uma caixa "Preview — se gerasse hoje" recalculada a cada
   mudança de campo, espelhando a cadeia completa do backend (mês-âncora → dia clampado → ajuste de
   dia útil → competência derivada). Fica oculta pra WEEKLY (fora do redesenho).

Os três espelhos client-side (`computeNextDueMonthClient`, `computeCompetenceForDueMonth`,
`computePreview`) duplicam lógica que já existe em `recurrence-dates.ts` no backend — aceito
deliberadamente pra evitar round-trip à API só pra um preview/default, mas **se a lógica de datas
mudar de novo, os três precisam ser atualizados junto** (não há teste de paridade automatizado
entre cliente e servidor pra esses três, diferente do teste de paridade que existe no backend entre
`computeNextDueMonth` e `computeDueMonthsToGenerate`).

## `generateManually` sem override pode gerar mês que o cron nunca produziria, pra QUARTERLY/ANNUAL ✅ (resolvido em 2026-10-08)

**Contexto:** `computeNextDueMonth` (usado quando "Gerar agora" é chamado sem escolher mês) não
verifica se o mês calculado bate com `dueMonthAnchor` do template — pra MONTHLY sempre bate (todo mês
é válido), mas pra QUARTERLY/ANNUAL pode devolver um mês que `computeDueMonthsToGenerate` (o cron)
jamais geraria sozinho, quebrando a paridade entre os dois caminhos que a spec original exigia.

**Resolvido:** `computeNextDueMonth` agora avança mês a mês a partir do candidato mínimo
(hoje + `generationMonthOffset`) até achar um que bate com `dueMonthAnchor` — mesma regra de
match que `computeDueMonthsToGenerate` usa, nunca retrocede. MONTHLY inalterado (todo mês é
válido, retorna o candidato mínimo direto). Testes novos cobrindo candidato que já bate de cara,
candidato que precisa avançar, e um teste de paridade explícito comparando o resultado contra o
que `computeDueMonthsToGenerate` aceitaria no mês de gatilho correspondente.

## Arquivos de som do sistema não existem ainda (SLA/alertas de prazo, 2026-10-08)

**Contexto:** `useSlaAlerts.ts` referencia `/sounds/chime.mp3`, `/sounds/bell.mp3` e
`/sounds/soft-ping.mp3` (`apps/web/public/sounds/`), mas esses 3 arquivos de áudio nunca foram
criados — são binários, não dá pra gerar via código. `playSound` degrada graciosamente (`try/catch`
silencioso em volta de `audio.play()`), então a ausência não quebra nada: toast e badge visual
continuam funcionando, só o som não toca.

**Pendente:** antes de considerar a funcionalidade de som "pronta pra usuário final", conseguir (ou
licenciar) 3 sons curtos (~1s, royalty-free, uso comercial liberado) e salvá-los exatamente nesses
3 caminhos. Sem isso, a opção de som do sistema (`CHIME`/`BELL`/`SOFT_PING`) fica silenciosa — só o
som customizado da organização (upload próprio) funciona de fato hoje.
