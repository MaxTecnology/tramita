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

## Migration `20260920160000_add_departments` assume `client_assignments` vazia (encontrado em 2026-09-20) ✅ (fechado em 2026-11-12)

**Contexto:** essa migration foi escrita à mão (o CLI do Prisma recusa migrations destrutivas não-interativas) e adiciona `client_assignments.departmentId` como `NOT NULL` sem `DEFAULT`. Isso só é seguro porque a tabela foi verificada vazia em dev/test antes da migration rodar — o arquivo agora tem um comentário de aviso no topo (`apps/api/prisma/migrations/20260920160000_add_departments/migration.sql`).

**Pendente:** se este repositório for implantado em um ambiente com dados reais em `client_assignments` antes de uma reescrita, a migration falhará. Nesse caso, ela precisa ser reescrita com um passo de backfill de `departmentId` antes de adicionar a constraint `NOT NULL`.

**Fechado (2026-11-12):** o banco online foi zerado antes do deploy e a migration já foi aplicada em todos os ambientes existentes — ela nunca mais roda sobre dados reais. Só voltaria a importar num banco novo restaurado de um backup anterior a 2026-09-20, que não existe.

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

## Arquivos de som do sistema não existem ainda (SLA/alertas de prazo, 2026-10-05) ✅ (resolvido em 2026-10-08)

**Contexto:** `useSlaAlerts.ts` referencia `/sounds/chime.mp3`, `/sounds/bell.mp3` e
`/sounds/soft-ping.mp3` (`apps/web/public/sounds/`), mas esses 3 arquivos de áudio nunca foram
criados — são binários, não dá pra gerar via código. `playSound` degrada graciosamente (`try/catch`
silencioso em volta de `audio.play()`), então a ausência não quebra nada: toast e badge visual
continuam funcionando, só o som não toca.

**Resolvido:** usuário forneceu 3 arquivos MP3 reais (confirmado via magic bytes — assinatura
`0xFF 0xFB`, mesma validação usada no upload de som customizado), salvos em
`apps/web/public/sounds/` com os nomes exatos que o código espera. Mapeamento escolhido por nome
de arquivo original (sem conseguir ouvir o conteúdo): `soft-ping.mp3` (era "notificacao.mp3"),
`chime.mp3` e `bell.mp3` (eram os dois arquivos da pack "universfield-new-notification"). O
usuário pode reatribuir/trocar os arquivos a qualquer momento — os 3 caminhos e nomes são fixos no
código, qualquer `.mp3` colocado no lugar certo passa a ser o som padrão daquele nível.

## `Task.completedAt` não tem backfill pra tarefas concluídas antes deste deploy ✅ (resolvido em 2026-10-08 — decidido não fazer)

**Contexto:** a feature de Métricas de Produtividade introduziu `Task.completedAt`, setado só a
partir de agora (nos 3 pontos de escrita de status). Toda tarefa que já estava `DONE` antes desse
deploy tem `completedAt = NULL` — ela não aparece em volume, cumprimento de prazo nem tempo médio
de conclusão de nenhum período anterior à entrada em produção dessa feature, mesmo estando
genuinamente concluída.

**Resolvido:** decidido não fazer backfill. O ambiente atual é staging/validação — os dados serão
zerados antes do uso real e contínuo da tela de Produtividade, então reconstruir o passado desse
banco não tem valor. Se um backfill for necessário no futuro (ex: outro ambiente com dado real
acumulado antes de uma feature similar), a abordagem fica registrada aqui como referência: derivar
`completedAt` da última entrada `status_changed` com `toValue='DONE'` no `TaskHistory` de cada
tarefa, com fallback em `updatedAt` pra tarefas concluídas só via Kanban antes da correção que
unificou o histórico (ver `fix(metrics)` nesta mesma feature).

## Achados do review final — Evolução de Solicitações → OS (2026-10-10) ✅ (todos resolvidos até 2026-11-10)

Revisão final (`docs/superpowers/plans/2026-10-08-evolucao-solicitacoes-os-plan.md`) encontrou os
seguintes pontos — os 2 "ALTO" e 1 "MÉDIO" ligados ao Review Focus da spec foram corrigidos na
mesma sessão (race no auto-revert de NEEDS_INFO, `TaskHistory`/`publishBoardEvent` ausentes em
`cancelApprovedRequest`, e o gate de zero-atividade não contava `TaskDocumentRequirement`/
`TaskDeliverable`). Os demais, deferidos:

- **Notificação pro staff sem `clientName`** ✅ (resolvido em 2026-10-19, nos dois lugares juntos
  como a nota original pedia). `comments.service.ts` e `request-comments.service.ts` agora
  incluem `client.name` na query (`task.column.board.client`/`request.client`) e passam
  `clientName` no metadata da notificação USER quando o cliente comenta — a equipe deixa de
  receber "Olá, ! Novo comentário...".
- **UI não reflete o auto-revert em tempo real** ✅ (resolvido em 2026-10-19). `Comments.tsx`
  (compartilhado entre portal e admin) agora invalida `['portal-requests']` e `['requests']` junto
  com sua própria query ao criar um comentário de `entityType: 'request'` — inofensivo no
  contexto que não tem a chave em cache. `useRequestsBadgeStream.ts` agora invalida `['requests']`
  e `['request-comments']` (sem id — por prefixo, cobre qualquer painel de comentários aberto) no
  `request:changed`, além da contagem de pendentes que já invalidava. Confirmado em QA manual real
  (API como cliente comentando numa request NEEDS_INFO + navegador aberto como admin na aba
  "Precisa de informação"): a lista perde o item e o badge do menu atualiza sozinho, sem refresh.
- **Aprovar/rejeitar a partir de NEEDS_INFO** deixa a resposta do cliente (se vier depois) perdida
  na thread de uma Request já fechada, sem refletir na Task ✅ (resolvido em 2026-11-10). `TaskDrawer.tsx`
  agora mostra, na aba Comentários, uma seção colapsável "Solicitação de origem" quando
  `task.sourceRequestId` existir, reaproveitando `Comments` com `entityType="request"` (só pra
  `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER`, nunca pro `CLIENT`). Um badge "Resposta não vista" aparece
  (mesmo com a seção colapsada) quando o último `RequestComment` do cliente é mais recente que o
  último do staff — `hasUnseenClientReply` em `apps/web/src/lib/request-comments.ts`, 5 testes
  unitários. Confirmado em QA manual real no navegador (dados de teste criados e removidos em
  seguida): badge aparece com a thread terminando em comentário do cliente, some assim que o staff
  responde.
- **Validação de entrada frouxa** ✅ (resolvido em 2026-10-19). `createRequestCommentSchema`,
  `needsInfoRequestSchema` e `cancelApprovedRequestSchema` agora usam `.trim().min(1, ...).max(4000, ...)`
  — texto só com espaços é rejeitado (400), limite de 4000 caracteres (WhatsApp tem limite
  documentado de ~4096). `createCommentSchema` (comentário de Task, mesmo gap, não citado na nota
  original mas idêntico) corrigido junto por consistência.
- **`RequestComment` sem índice** `@@index([requestId, createdAt])` ✅ (resolvido em 2026-10-19).
  `Comment` ganhou o mesmo `@@index([taskId, createdAt])` junto (débito pré-existente ao Plano de
  Solicitações→OS, mesmo padrão). Migration `20261020010000_comment_request_comment_indexes`.
- **Inconsistências menores** ✅ (todas resolvidas em 2026-10-19):
  - `cancelRequest` (cliente) agora grava `cancelledByType: 'CLIENT'` + `cancelledById`.
  - `listRequestComments` falha fechado (404) se `role==='CLIENT'` sem `clientUserId`, em vez de
    pular a checagem de escopo silenciosamente.
  - `deleteRequestComment` e `deleteComment` (o "original" que tinha o mesmo gap — corrigido
    junto) respondem 404 pra tenant cruzado, não mais 403 — nunca revelam que o comentário existe
    pra quem está fora da org.
  - Link "Ver processo"/"Abrir processo" (portal e admin) não aparece mais numa Request
    `CANCELLED` mesmo com `boardId` presente — a tarefa associada virou `DISREGARDED`, não é mais
    um processo ativo.

## Automação de documentos fiscais (Plano A) — débitos da revisão final (2026-10-16) ✅ (todos fechados até 2026-11-12)

Achados da revisão final (fresh reviewer, Opus) que não bloqueiam uso real e ficaram deferidos.
Contexto completo em `docs/superpowers/specs/2026-10-15-automacao-documentos-fiscais-design.md` e
`docs/superpowers/plans/2026-10-15-automacao-documentos-fiscais-plan-a.md`.

- **Isolamento de processo incompleto no parser de PDF** ✅ (resolvido em 2026-11-11). A extração
  de texto do pdf.js agora roda numa `worker_thread` dedicada (`extrair-texto-worker.ts`), isolada
  do processo principal — `Worker.terminate()` consegue interromper até um laço síncrono travado
  em JS puro, ao contrário do antigo `loadingTask.destroy()` que só funcionava se o pdf.js cedesse
  o event loop a tempo de checar o timeout. `extrair-texto.ts` virou um wrapper fino sobre o
  executor genérico `src/lib/isolated-worker.ts` (`executarIsolado`), reaproveitável por qualquer
  parser futuro de entrada não confiável. Resolvido também o impasse do teste: em vez de tentar
  mockar o `pdfjs-dist` (continua impossível, exports ESM congelados), o mecanismo de isolamento é
  testado genericamente com um worker de teste dedicado que roda um `while(true){}` de propósito —
  prova real, sem mock, de que `terminate()` interrompe o laço e a thread principal nunca trava
  esperando (`isolated-worker.test.ts`, 4 testes). `extrair-texto.test.ts` prova com PDFs reais
  (gerados via `pdfkit`, mesmo padrão de `pipeline.test.ts`) que o resultado não mudou. Log de erro
  com marcador `event: 'pdf_extraction_timeout'` quando o timeout disparar — sem Sentry/Datadog
  integrado, o escopo decidido foi só isolamento + log estruturado, não alerta/paging novo.
  Complicador técnico: o arquivo da worker precisa resolver diferente em dev/teste (`.ts` via
  `tsx`, registrado via `execArgv: ['--import', 'tsx']`) e produção (`.js` já compilado em
  `dist/`, sem `tsx` — é devDependency) — resolvido checando a extensão do próprio
  `import.meta.url` em runtime. Validado com um smoke test real contra o build compilado
  (`pnpm build` + `node` puro, sem `tsx`), não só contra os testes.
- **`trocarTarefa`** não confere no backend se a tarefa de destino é do mesmo cliente do CNPJ lido
  no documento ✅ (resolvido em 2026-10-18). Mitigado em 2026-10-16 (commit 2ab126a) na UI (seletor
  cliente→tarefa). Resolvido por completo com `assertCnpjBateComTarefa`
  (`document-reader.service.ts`): compara o CNPJ extraído (`valido: true`) contra
  cnpj/cpf/cei/caepf/inscricaoEstadual do cliente da tarefa de destino antes de baixar o arquivo
  do B2 — 422 com mensagem clara se não bater. Documento sem CNPJ extraído não tem o que validar,
  segue sem bloquear (upload manual, por exemplo).
- **Rotas de `document-reader.routes.ts`** não validam `:id` via Zod ✅ (investigado e fechado em
  2026-10-18 — não é um bug real). A premissa original estava errada: `grep -rc "request.params as"
  apps/api/src/modules/*/*.routes.ts` mostra que as 22 outras rotas do projeto (boards, clients,
  tasks, os-templates, etc.) fazem exatamente o mesmo cast `request.params as { id: string }` sem
  Zod — é o padrão universal do projeto, não uma exceção do document-reader. Um `id` malformado
  (não-cuid) não quebra nada: o Prisma `findFirst`/`findUnique` por um `String @id` simplesmente não
  acha nenhum registro e devolve `null`, o service lança 404 normal — nunca um 500. Adicionar Zod só
  aqui criaria uma inconsistência nova com as outras 22 rotas, sem nenhum ganho de comportamento.
- **`ingerirDocumento`** faz upload ao B2 antes do insert no banco ✅ (resolvido em 2026-10-18).
  O catch do P2002 de dedupe agora chama `deleteFile(storageKey)` antes do 409, limpando o upload
  órfão da requisição que perdeu a corrida; falha ao apagar vira log (Pino), nunca esconde o 409
  real. Testado com uma corrida de verdade (`Promise.all` de duas chamadas concorrentes contra o
  Postgres real).
- **Seed de `DocumentModel`** (`apps/api/prisma/seed-document-models.ts`) é idempotente só por
  `name` ✅ (resolvido em 2026-10-18). Agora casa pelo `id` (slug) de dentro do JSON — o que de
  fato identifica qual arquivo originou o registro, já que `name` é só rótulo de UI — e compara o
  conteúdo (deep-equal com números normalizados, pra absorver o drift de precisão do round-trip
  do Postgres JSONB) contra o existente: sem mudança, idempotente; com mudança, `UPDATE` com
  `version: { increment: 1 }` em vez de silenciosamente ignorar. Editar o JSON de um modelo global
  (ex.: o ajuste multi-filial do PGDAS-D) agora atualiza o registro e versiona de verdade.
- **`@@unique([organizationId, code])`** em `ObligationType` não impede `code` duplicado entre
  registros globais ✅ (resolvido em 2026-10-19 — o Plano B já estava implementado, cadastro de
  obrigações pelo usuário é real). Índice único parcial adicional (migration
  `20261019020000_obligation_type_global_code_unique`):
  `CREATE UNIQUE INDEX ... ON obligation_types(code) WHERE "organizationId" IS NULL` — escopado só
  às linhas globais, não interfere na unicidade por organização que o índice original já cobre.
  Testado contra o Postgres real (não simulação de erro), documentado em `schema.prisma` já que a
  sintaxe do Prisma schema não expressa índice parcial.
- **Sem índices** `(organizationId, status)` pra consulta da fila de revisão nem
  `(status, reviewedAt)` pro cron de expurgo ✅ (resolvido em 2026-10-19). Adicionados em
  `ReceivedDocument` (migration `20261019021000_received_document_review_queue_indexes`).
- **`getOrgSlug`** duplicado entre `attachments.service.ts` e `document-reader.service.ts`
  ✅ (resolvido em 2026-10-19). Extraído pra `@/lib/org-slug.ts`, com teste próprio.
- **Sem tela pra listar documentos `REJECTED` e reabri-los** ✅ (resolvido em 2026-10-19). Nova aba
  "Rejeitados" em `ReviewQueue.tsx`, novo endpoint `GET /document-reader/rejeitados`
  (`listarRejeitados`) mostrando arquivo + quem rejeitou + quando, botão "Reabrir" chama o
  `reabrirDocumento` que já existia (inclusive já recusava reabrir um documento expurgado pelo
  cron LGPD). Confirmado em QA manual: documento some de Rejeitados e reaparece em Processando na
  fila.
- **`purgeRejectedDocuments`** aborta o laço inteiro se um `deleteFile` falhar no meio ✅ (resolvido
  em 2026-10-19). Cada documento agora tem seu próprio try/catch — uma falha (B2 fora do ar) loga
  via Pino (`logger.error`) e segue pro próximo; o que falhou continua íntegro (storageKey nunca
  vira `''`) pra tentar de novo na execução seguinte do cron.
- **`POST /document-reader/modelos/analisar`** ✅ (fechado em 2026-11-12) roda `extrairDocumento` (parsing de PDF via pdf.js)
  direto no event loop da API, em vez de via fila BullMQ como o Plano A faz pro upload real
  (`document-reader.worker.ts`). Aceitável pro v1: rota só acessível a `ORG_ADMIN`, PDF de amostra
  limitado a 20MB, sem persistência. Revisitar se virar vetor de lentidão (muitos admins
  modelando ao mesmo tempo) ou de negação de serviço. **Fechado:** desde 2026-11-11 `extrairDocumento`
  roda numa `worker_thread` isolada com timeout (`executarIsolado`) — o parsing não ocupa mais o event
  loop da API, que era o motivo da nota.
- **Salvar um `DocumentModel` privado pode desligar o reconhecimento de outro modelo ativo da
  mesma org sem nenhum aviso** ✅ (resolvido em 2026-10-18). Mitigado com
  `verificarColisaoModelo` (`document-reader-models.service.ts`): no momento de salvar
  (`POST /document-reader/modelos/verificar-colisao`), roda `pontuarModelos` da amostra contra
  os modelos ativos da org (excluindo o próprio, em edição) e avisa — não bloqueia — se outro
  modelo também bate com `scoreAncoras >= LIMIAR_ANCORAS` na mesma amostra. Confirmado em QA
  manual: criar um segundo modelo com a mesma âncora de um já existente dispara o toast de aviso
  e ainda assim salva. Continua não sendo a "análise de impacto contra documentos já recebidos"
  completa (fora de escopo v1 por decisão explícita da spec) — só avisa sobre a amostra atual,
  não re-varre documentos já processados.

## Worker (e API) carregam o `.env` depois dos imports — worker não sobe localmente (encontrado em 2026-11-11) ✅ (resolvido em 2026-11-12)

**Sintoma:** `pnpm --filter api worker` quebra na inicialização com `Missing API key` do Resend,
mesmo com `RESEND_API_KEY` no `.env`. Derruba o worker inteiro — notificações de WhatsApp/e-mail,
leitura de documentos e os crons — não só o e-mail.

**Causa:** `src/worker.ts` e `src/app.ts` chamam `config()` do `dotenv` no corpo do módulo, mas em
ESM todos os `import` estáticos são avaliados **antes** do corpo. Qualquer módulo que lê
`process.env` no topo do arquivo (ex.: `src/lib/mailer.ts`, que faz
`new Resend(process.env.RESEND_API_KEY)` no import) enxerga o ambiente vazio. Em produção não
aparece porque o Dokploy injeta as variáveis no processo antes de qualquer código rodar. A API
só não quebra hoje porque não importa o `mailer` na inicialização.

**Contorno usado no teste local:** `npx tsx --env-file=../../.env src/worker.ts` e um
`RESEND_API_KEY=re_local_placeholder` no `.env` local (fora do git).

**Correção sugerida:** carregar o `.env` num módulo próprio importado como **primeiro** import
(`import './load-env'`), ou passar `--env-file` nos scripts `dev`/`worker` do `package.json`; e
criar o cliente do Resend sob demanda (dentro de `sendEmail`), pra que a falta da chave de e-mail
falhe só o envio de e-mail, nunca a subida do worker. Teste: subir o worker sem `RESEND_API_KEY`
e confirmar que os outros workers iniciam.

**Resolvido:** `src/load-env.ts` é o primeiro import de `app.ts` e `worker.ts`; o Resend nasce no
primeiro envio (`getResend()`), e sem chave só o e-mail falha (`mailer.test.ts`). Validado de verdade:
`pnpm worker` sobe sem `--env-file`, e `RESEND_API_KEY= tsx src/worker.ts` sobe todos os workers.

## E2E não cobre os fluxos novos da cobertura de departamentos (encontrado em 2026-11-11) ✅ (resolvido em 2026-11-12)

O cadastro de cliente em abas (painel de cobertura, bloqueio do salvar), a tela "Transferir
responsabilidades" e o alerta de recorrentes não geradas no Dashboard foram validados com testes de
unidade/integração (API e lógica pura do formulário) e QA manual no navegador, mas não têm spec
Playwright. Os 8 specs E2E existentes continuam passando com o seed atualizado. Vale escrever ao
menos um spec por fluxo (cadastro completo de cliente; transferência em dois lotes até desativar)
quando a próxima rodada de E2E for mexida.

**Resolvido:** `e2e/flows/client-form.spec.ts` (cadastro pelas três abas, salvar bloqueado até
completar) e `e2e/flows/user-transfer.spec.ts` (dois lotes até desativar). O alerta de recorrentes
não geradas continua só em teste de API/componente. 14/14 specs, estáveis em duas execuções seguidas.

## Cobertura de departamentos: checagem e escrita sem lock (encontrado na revisão final, 2026-11-11) ✅ (resolvido em 2026-11-12)

As invariantes de cobertura (`src/modules/clients/client-coverage.ts`) são checadas e gravadas na
mesma transação, mas sem lock de linha (Postgres em READ COMMITTED). Duas edições simultâneas podem
passar cada uma na sua checagem e juntas violar a regra. Exemplos: um admin tira o usuário B do
Fiscal no cadastro do cliente enquanto outro desativa o usuário A (o Fiscal fica sem usuário);
`createTask`/`approveRequest` checam o departamento fora da transação enquanto outro admin desmarca
esse departamento; `deleteUser` enquanto outra tela define a pessoa como responsável.

Exige dois administradores agindo no mesmo instante sobre o mesmo cliente — raro, e o próprio
cadastro do cliente mostra e corrige a cobertura quebrada. Correção sugerida: helper
`lockClients(tx, clientIds)` (`SELECT … FOR UPDATE` via `tx.$queryRaw`) no início de toda transação
que mexe em cobertura (cliente, usuário do cliente, tarefa, solicitação, desativação de usuário), e
levar a checagem de I5 do `createTask` pra dentro da transação.

**Resolvido:** `lockClients` (`FOR UPDATE` em ordem de id) abre as transações de cadastro do cliente,
usuário do cliente (criar/editar/desativar), criar/editar/mover tarefa e vínculo recorrente — a checagem
de departamento atendido passou pra dentro da transação. `deleteUser` trava o colaborador (`FOR UPDATE`)
e quem o define como responsável (cadastro, transferência) trava com `lockUsersForShare` (`FOR SHARE`).
Testes de corrida determinísticos em `client-coverage-lock.test.ts` (transação concorrente segurando o
lock com uma mudança não confirmada). A geração recorrente não precisou: desatender o departamento já é
recusado enquanto existe vínculo recorrente ativo.

## SSE autentica com o JWT na query string (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12)

`EventSource` não envia header `Authorization`, então `/requests/stream` e `/boards/:id/stream` recebem o JWT em `?token=`. O log da API já mascara (`src/lib/log-redaction.ts`, `?token=[REDACTED]`), mas o token ainda passa por qualquer outro ponto que registre URL: access log do Traefik (se ativado), histórico do navegador, ferramentas de APM.

**Correção sugerida:** ticket de uso único — `POST /stream/ticket` (autenticado por header) devolve um código aleatório guardado no Redis com TTL de 30s; o `EventSource` usa `?ticket=` e a rota consome (apaga) o ticket na primeira conexão. Assim o que aparece em URL não serve para mais nada.

**Antes de produção:** confirmar que o access log do Traefik está desligado ou sem query string.

**Resolvido:** `POST /stream/ticket` + `?ticket=` (Redis `sse-ticket:*`, 30s, `GETDEL`) nos dois streams;
`?token=` não é mais aceito; `ticket` também é mascarado no log. Validado no ambiente local (reuso → 401,
`?token=` → 401, log com `ticket=[REDACTED]`). **Ainda vale** conferir o access log do Traefik (Dokploy),
mas o que pode aparecer lá agora é um ticket já consumido.

## Prisma: `package.json#prisma` deprecado (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12)

O `migrate deploy` avisa que a configuração em `package.json#prisma` (seed) será removida no Prisma 7. Migrar para `prisma.config.ts` quando formos atualizar para o Prisma 7 — hoje é só aviso, não quebra nada.

**Resolvido:** `apps/api/prisma.config.ts` (schema, migrations, seed) carrega o `.env` da raiz sem
sobrescrever variáveis já definidas; o Dockerfile copia o arquivo. Build Docker validado, `prisma validate`
dentro da imagem ok.

## Visibilidade do ORG_MEMBER aplicada só em leitura de processo (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12)

A regra de visibilidade do Membro (`apps/api/src/modules/boards/board-visibility.ts`: responsável do
processo OU responsável por departamento que atende o cliente OU com tarefa atribuída) vale para
`GET /boards`, `GET /boards/:id` e `GET /dashboard/metrics`. As demais rotas que recebem um id de
processo/tarefa (`PATCH /boards/:id`, `/boards/:id/tasks/search`, `/boards/:id/stream`, mutações de
tarefa/coluna) ainda só checam a organização — um Membro que conheça o id consegue agir num processo
que não vê na lista. Mesma organização, sem vazamento entre tenants, mas fecha o modelo de permissão.

**Correção sugerida:** helper `assertMemberCanSeeBoard(boardId, user)` chamado nessas rotas quando
`role === 'ORG_MEMBER'`, com teste por rota (404 para processo fora do escopo).

**Resolvido:** preHandler `memberScope` (`src/middlewares/memberScope.ts`) em colunas, tarefas (criar,
mover, reordenar, editar, histórico), comentários, anexos, documentos da tarefa, protocolos da
tarefa/detalhe/recibo, busca e SSE do processo — 404 fora do escopo. 20 rotas testadas em
`member-scope.routes.test.ts`, mais o caso do Membro vinculado que continua agindo.

## Selos e tela de Assinatura com cores fixas claras (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12)

Selos `bg-gray-100 text-gray-600` (prioridade baixa, status, perfis) e a tela Configurações →
Assinatura (`bg-white`, `bg-gray-50`) não acompanham o modo escuro. Legíveis (fundo claro com texto
escuro), mas destoam. Trocar por tokens (`bg-neutral-bg text-neutral-text`, `bg-surface`).

**Resolvido:** eram ~300 classes fixas em 26 telas (não só selos e Assinatura). Trocadas por tokens,
com dois novos (`info-*` azul e `highlight-*` roxo) em claro e escuro. QA com screenshots reais nos dois
temas (Assinatura, Solicitações, Usuários, Clientes, Dashboard, TaskDrawer, portal e Master).

## E2E sem os fluxos do novo portal de documentos (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12, parcial por decisão)

O seed E2E já cria a "Guia DAS E2E" (guia de pagamento do cliente E2E), mas não há spec Playwright
para: Início do portal, "Documentos recebidos" → "Marcar como pago" → aparece como paga e some de
"Guias não pagas" no escritório; "Enviar documentos" com "Nada a enviar"; escritório entregando guia
com valor e substituindo o arquivo. Cobertos por testes de API e de componente, não ponta a ponta.

**Resolvido:** `e2e/flows/portal-documents.spec.ts` cobre Início → guia → "Marcar como pago" → sai de
"Guias não pagas" no escritório, e "Nada a enviar" + desfazer. **Fica fora por decisão:** a entrega de
guia e o substituir pelo escritório sobem o arquivo de verdade no B2 configurado no `.env` (a chamada é
do servidor, o Playwright não intercepta) — seguem cobertos pelos testes de API, incluindo as corridas.
Pra cobrir no E2E seria preciso um bucket/endpoint fake pro ambiente de teste.

## Detalhe do documento registra "Visualizado" a cada abertura (encontrado em 2026-11-12) ✅ (resolvido em 2026-11-12)

`GET /portal/protocols/:id` grava um evento `VIEWED` a cada chamada (regra antiga dos protocolos). No
novo detalhe, a tela recarrega depois de "Marcar como pago" e o histórico ganha um "Visualizado"
repetido. Inofensivo, mas polui o histórico: gravar `VIEWED` só na primeira visualização por usuário
(ou não registrar de novo se o último evento do mesmo usuário for `VIEWED` há poucos minutos).

**Resolvido:** um `VIEWED` por pessoa e por versão do arquivo (desde `fileUpdatedAt`): reabrir não
repete; arquivo substituído visto de novo conta.

## Portal de documentos — menores da revisão final (2026-11-12) ✅ (todos resolvidos em 2026-11-12)

1. **Corrida no robô:** em `anexarDocumento`, `deliverDocument` cria/substitui o protocolo e avisa o cliente antes da escrita guardada no `receivedDocument`. Dois revisores ao mesmo tempo: o perdedor recebe 409, mas já gerou um REPLACED e um segundo aviso. Correção: reservar o `receivedDocument` (status intermediário via `updateMany`) antes de entregar.
2. **Atualização parcial numa corrida rara:** `deliverDocument` grava arquivo/valor na entrega antes de `upsertProtocolForDeliverable`. Se o cliente pagar entre a checagem prévia e a escrita guardada, o 409 sobe com a entrega já atualizada e o protocolo antigo. Correção: substituir o protocolo antes ou compensar no erro.
3. **409 com mensagem de "guia paga"** quando o motivo real foi um cancelamento concorrente (`replaceProtocolFileCore`/`updateProtocolPayment`). Reler o registro e escolher a mensagem.
4. **Arquivo órfão quando a escrita guardada perde:** `markProtocolPaid` (comprovante) e `replaceProtocolFile` sobem o arquivo antes do `updateMany`; num 409 o arquivo fica sem uso no B2.
5. **Valor lido pelo robô passa por `number`** (`parseMoeda` → `toFixed(2)` em `pagamentoLido`). Exato para 2 casas, mas fere a convenção "nunca float"; o motor deveria expor a string normalizada.
6. **Comprovante maior que 20MB** em `POST /portal/protocols/:id/pay` não vira `AppError(413)` em pt-BR como em `/protocols/:id/replace`.
7. **`replaceProtocolFile` aceita `amount`** em protocolo que não é guia (a tela não envia, mas a API grava). Ignorar o valor quando `requiresPayment = false`.

**Resolvidos:** (1) `anexarDocumento` reserva o documento (`attachingSince`, prazo de 5 min) antes de
qualquer efeito — o segundo revisor recebe 409 sem subir arquivo nem gerar REPLACED/aviso; rejeitar
respeita a reserva. (2) A reentrega troca o protocolo (escrita protegida) antes de atualizar a entrega.
(3) `lockedProtocolError` relê o registro e diz se foi pagamento ou cancelamento. (4)
`discardUploadedAttachment` apaga o arquivo que perdeu a corrida (substituir, reentregar, comprovante).
(5) `moedaNormalizada` — o valor sai do texto lido, sem float. (6) `readUpload` responde 413 em pt-BR em
todos os uploads. (7) Valor e vencimento ignorados em documento que não é guia.

## Uploads sem validação de tipo de arquivo (encontrado e resolvido em 2026-11-12) ✅

Só a rota de anexos tinha lista de tipos; entrega de documento, substituir, comprovante e uploads do
portal aceitavam qualquer arquivo. **Resolvido:** política única (`src/lib/upload-policy.ts` +
`src/lib/read-upload.ts`) em todas as rotas: tipo decidido pela extensão numa lista permitida (PDF,
imagens, Office, TXT, CSV, XML, OFX, ZIP) — nunca pelo Content-Type do navegador —, e XML/Office/ZIP
gravados no B2 com `Content-Disposition: attachment`. O web filtra o seletor de arquivo com `accept`.
