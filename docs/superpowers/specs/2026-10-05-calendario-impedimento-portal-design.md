# Calendário Mensal + Sinalização de Impedimento no Portal — Design

> Sub-fases 2d e 2e do roadmap de Tarefas Recorrentes (`docs/TASKS.md`, Fase 10, item 2). O item 2c
> (visão cross-cliente) foi avaliado e considerado já satisfeito pela tela "Tarefas" existente
> (filtro por `recurringTemplateId` já cruza clientes diferentes) — fechado sem trabalho novo.

## Contexto

Depende de 2a (Departamentos) e 2b (motor de recorrência + status expandido), ambos concluídos. O
produto já tem: tela "Tarefas" (Lista + Kanban dinâmico por status) do lado do escritório, e uma
tela equivalente simplificada do lado do portal do cliente (`portal/Tasks.tsx`), além de um board
por processo também no portal (`portal/Board.tsx`).

Dois gaps reais, confirmados durante o brainstorming:
1. Não existe visão de calendário em lugar nenhum do sistema.
2. O Kanban por board do portal do cliente (`portal/Board.tsx`) não mostra nenhum selo de status no
   card da tarefa — uma tarefa `BLOCKED` ("Com Impedimento") é visualmente idêntica a uma aberta, e
   não existe notificação ativa quando uma tarefa do cliente entra nesse estado.

## Fora de escopo

- Drag-and-drop de data no calendário (arrastar um card pra outro dia) — fica só leitura por agora.
- Calendário do lado do portal do cliente — só escritório nesta fase.
- Forçar a notificação de impedimento através do toggle global da organização — ao contrário do
  `Column.notifyClient` (que intencionalmente ignora `config.taskMoved`), a notificação de
  impedimento **respeita** o toggle da org (`config.taskBlocked`) — é o controle explícito que o
  escritório pediu, não um bypass.
- Um segundo TaskDrawer ou componente de status pro portal — a lacuna de status no board do portal
  é só no card, o drawer (`apps/web/src/components/portal/TaskDrawer.tsx`, já um re-export do
  `TaskDrawer` compartilhado) já mostra status corretamente.

---

## 1. Calendário mensal (2d)

### Onde vive

Terceiro modo na tela "Tarefas" existente (`apps/web/src/pages/app/Tasks.tsx`): `view: 'list' |
'kanban' | 'calendar'`. Mesmo conjunto de filtros (cliente, colaborador, departamento, tipo de
tarefa recorrente, status, busca por título) e mesma query `GET /tasks` (via `useInfiniteQuery`,
sem mudança de contrato) — só muda a visualização dos resultados.

### Janela de dados

O calendário mostra um mês por vez. Ao navegar pra outro mês, o componente ajusta os filtros
`dateFrom`/`dateTo` (os mesmos já aceitos por `GET /tasks`) pros limites do mês visível (incluindo
os dias cinza do mês anterior/seguinte que completam a grade de semanas) e deixa o `useInfiniteQuery`
existente buscar — nenhuma mudança de backend é necessária pra isso. Um mês real de tarefas fica bem
abaixo do teto de 500 da paginação existente; o botão "Carregar mais" já implementado cobre o caso
raro de um mês com mais de `limit` tarefas.

### Posicionamento no grid

Cada tarefa aparece no dia de `targetDate`; se `targetDate` for `null`, cai em `dueDate`. Uma tarefa
sem nenhuma das duas datas não aparece no calendário (consistente com o critério de ordenação que a
Lista já usa). Tarefas com `status: DISREGARDED` são excluídas (mesmo filtro implícito que o board do
portal já aplica pra tarefas desconsideradas).

**Agrupamento por dia precisa seguir a convenção "date-only UTC" que `apps/web/src/lib/dates.ts` já
estabelece** (usada por `formatDateOnlyUTC`/`isPastDateOnlyUTC`, ver `TaskRow`/cards existentes) — as
datas do banco são "dia puro" armazenado como UTC-midnight, e agrupar usando o dia no fuso LOCAL do
navegador (ex.: `new Date(task.targetDate).getDate()`) desloca a tarefa pro dia errado pra qualquer
usuário num fuso atrás de UTC (o caso comum no Brasil, UTC-3) — exatamente o tipo de bug que esse
arquivo já existe pra evitar. `buildCalendarGrid` usa a mesma lógica de "dia UTC" que
`utcDayFromUTCDate`/`utcDayFromLocalDate` (hoje privadas em `dates.ts`) já implementam — exportar um
helper dedicado de `dates.ts` (ex.: `utcDateKey(date): string` retornando uma chave `'YYYY-MM-DD'`
estável) em vez de duplicar a lógica dentro de `Tasks.tsx`.

### Densidade por dia

Até 2 tarefas renderizadas diretamente na célula (card compacto: título truncado + selo de status,
reaproveitando `STATUS_COLOR`); a partir da 3ª, um link `"+N mais"` abre um popover com a lista
completa daquele dia. Clicar em qualquer tarefa (direto na célula ou dentro do popover) abre o mesmo
`TaskDrawer` já usado pela Lista e pelo Kanban, derivando o objeto ao vivo do array `tasks` (mesmo
padrão corrigido no débito técnico de 2026-10-05 — nunca um snapshot).

### Navegação

Header com "‹ Mês Ano ›" e um botão "Hoje" que volta pro mês corrente. Grade de domingo a sábado,
semanas completas (dias fora do mês corrente aparecem esmaecidos, ainda clicáveis se tiverem
tarefa).

### Novo componente

`apps/web/src/pages/app/Tasks.tsx` ganha um sub-componente `CalendarView` (mesmo arquivo, seguindo a
granularidade que `Tasks.tsx` já usa pra `TaskRow`/`DraggableTaskCard`) que recebe `tasks` (o array já
achatado das páginas) e `onTaskClick`. Lógica de agrupamento por dia e geração da grade de semanas
fica em uma função pura separada (`buildCalendarGrid(tasks, month)`), testável isoladamente.

---

## 2. Sinalização de impedimento no portal (2e)

### 2.1 Selo visual no card do board do portal

`apps/web/src/pages/portal/Board.tsx` ganha um selo de status no card da tarefa, reaproveitando
`STATUS_LABEL`/`STATUS_COLOR` já exportados de `apps/web/src/components/shared/TaskDrawer.tsx` (os
mesmos usados em `Tasks.tsx` e `portal/Tasks.tsx`). Mostrado só quando `status !== 'OPEN'` — no caso
comum (tarefa aberta, fluindo normalmente) o card continua limpo como hoje; `STARTED`/`BLOCKED`/
`DONE` ganham o selo, com `BLOCKED` ("Com Impedimento") visualmente destacado (mesma cor vermelha já
usada pra atraso, mas num selo distinto, não substituindo o aviso de atraso).

### 2.2 Notificação `TASK_BLOCKED`

**Schema:**
- `NotificationEvent` ganha o valor `TASK_BLOCKED`.
- `NotificationConfig` ganha `taskBlocked Boolean @default(true)` — mesmo default de
  `dueDateAlert`/`documentRejected` (eventos que avisam o cliente final sobre algo que precisa da
  atenção dele, ligados por padrão).
- Migration hand-written de duas partes: `ALTER TYPE "NotificationEvent" ADD VALUE 'TASK_BLOCKED'`
  (sozinha, sem uso na mesma migration — mesma regra já seguida pro `STARTED` de `TaskStatus`) e
  `ALTER TABLE "notification_configs" ADD COLUMN "taskBlocked" BOOLEAN NOT NULL DEFAULT true`.

**Worker:** `apps/api/src/workers/notification.worker.ts`'s `EVENT_FLAG_MAP` ganha
`TASK_BLOCKED: 'taskBlocked'` — nenhuma outra mudança no worker é necessária; o mecanismo de gate
por `config[EVENT_FLAG_MAP[event]]` já existe e é exatamente o controle por organização que o
usuário pediu. **Esta notificação nunca usa `forceChannels`** — ao contrário do `Column.notifyClient`
(que intencionalmente ignora o toggle global pra um caso de uso diferente), aqui o toggle da
organização é a única palavra final.

**Template padrão:** nova entrada em `apps/api/src/lib/default-templates.ts`'s `DEFAULT_TEMPLATES`,
seguindo o formato de `DOCUMENT_REJECTED` (que já usa as mesmas variáveis disponíveis:
`clientName`, `taskTitle`, `portalUrl` — nenhuma variável nova em `TemplateVars` é necessária):

```
TASK_BLOCKED: {
  WHATSAPP: { body: 'Olá, {{clientName}}! A tarefa *{{taskTitle}}* está com impedimento e precisa da sua atenção.\n\nAcesse: {{portalUrl}}' },
  EMAIL: { subject: 'Tarefa com impedimento — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nA tarefa *{{taskTitle}}* está com impedimento e precisa da sua atenção.\n\nAcesse: {{portalUrl}}' },
}
```

**Ponto único de disparo — `notifyIfBlocked`:** uma tarefa pode transicionar pra `BLOCKED` por três
caminhos distintos hoje:
1. `recalculateTaskStatus` (`apps/api/src/modules/task-documents/task-documents.service.ts`) —
   quando um `TaskDocumentRequirement` fica `PENDING`/`REJECTED`.
2. `moveTask` (`apps/api/src/modules/tasks/tasks.service.ts`) — quando a coluna de destino tem
   `statusEffect: BLOCKED`.
3. `updateTask` (mesmo arquivo) — edição manual de status pelo escritório via `TaskDrawer`.

Em vez de duplicar "se o novo status é BLOCKED e o anterior não era, notifica" nos três lugares, um
helper único `notifyIfBlocked(taskId: string, previousStatus: TaskStatus, newStatus: TaskStatus,
clientId: string, organizationId: string, taskTitle: string): Promise<void>` — chamado nos três
pontos imediatamente após a escrita do novo status ser confirmada. Dispara
`enqueueNotification({ event: 'TASK_BLOCKED', organizationId, clientId, taskId, metadata: { taskTitle } })`
só quando `newStatus === 'BLOCKED' && previousStatus !== 'BLOCKED'` — nunca re-notifica uma tarefa
que já estava bloqueada e teve outro campo editado.

**Onde mora o helper — evitando import circular:** `tasks.service.ts` já importa
`recalculateTaskStatus` de `task-documents.service.ts` (dependência estabelecida desde a correção do
débito técnico de `moveTask`/documentos em 2026-10-05). Colocar `notifyIfBlocked` em
`tasks.service.ts` e fazer `task-documents.service.ts` importá-lo de volta criaria um ciclo. O
helper mora em `task-documents.service.ts` (ao lado de `recalculateTaskStatus`, que já calcula a
transição de status internamente e é o "dono" natural dessa lógica) e é exportado de lá —
`tasks.service.ts` importa de `task-documents.service.ts`, mesma direção de dependência que já
existe hoje, sem ciclo.

**Dado adicional que `recalculateTaskStatus` precisa buscar:** hoje seu `findUniqueOrThrow` seleciona
`documentRequirements`/`deliverables`/`recurringTemplate`, mas não `clientId`/`organizationId` (vêm
de `task.column.board`). Passa a incluir `column: { select: { board: { select: { clientId: true,
organizationId: true } } } }` no mesmo `include`, pra ter o que `notifyIfBlocked` precisa sem uma
query extra.

**Confirmado por varredura (`grep -rn "task.update(" apps/api/src/modules`), não é uma suposição:**
existem exatamente três pontos no código inteiro que escrevem `Task.status` — `moveTask`,
`updateTask`, e o próprio `prisma.task.update` dentro de `recalculateTaskStatus`
(`task-documents.service.ts:221`). `reorderTasks` e o `prisma.task.update` de
`requests.service.ts` (que só grava `sourceRequestId`) nunca tocam `status`. Os três pontos cobertos
pelo design acima são realmente todos os pontos de escrita — não uma simplificação otimista.

### 2.3 Configurações de Notificações

**Achado crítico durante a revisão da spec — sem isso o toggle da UI não tem efeito nenhum:**
`apps/api/src/modules/notifications/notifications.schema.ts`'s `updateConfigSchema` é uma lista
manual de `z.boolean().optional()` — **não deriva automaticamente do model Prisma**. Um `z.object()`
comum descarta silenciosamente qualquer campo que o payload mande mas o schema não declare (sem
erro, sem aviso). Confirmado grepando o próprio arquivo: `recurringGenerationFailed` e
`documentRejected` já existem no `NotificationConfig` do schema, têm default `true`, e o worker já os
usa via `EVENT_FLAG_MAP` — mas **nenhum dos dois está em `updateConfigSchema`**, então mesmo que
existissem na UI, salvar não gravaria nada. `taskBlocked` **precisa** de uma linha própria em
`updateConfigSchema` (`taskBlocked: z.boolean().optional()`) — adicionar só o toggle na tela sem essa
linha reproduziria exatamente esse bug silencioso pro recurso que o usuário pediu.

**Checklist completo de onde `TASK_BLOCKED`/`taskBlocked` precisa aparecer** (rastreado seguindo o
padrão ponta a ponta de um evento já existente, `TASK_DUE_DATE_APPROACHING`/`dueDateAlert`):
1. `apps/api/src/modules/notifications/notifications.schema.ts`'s `updateConfigSchema` — campo novo
   (crítico, ver acima).
2. `apps/web/src/pages/app/settings/Notifications.tsx` — `Config` interface ganha `taskBlocked?:
   boolean`; nova linha de toggle ("Tarefa com impedimento"), mesmo padrão visual de
   `taskMoved`/`dueDateAlert`; `EVENT_LABEL` ganha `TASK_BLOCKED: 'Tarefa com impedimento'` (usado na
   tabela de histórico de envios da mesma tela).
3. `apps/web/src/pages/app/settings/Templates.tsx` — a tela de edição de mensagem customizada por
   evento tem seu próprio array `EVENTS` (hoje só 5 dos 10 valores de `NotificationEvent` — nem todo
   evento existente tem editor de template hoje, gap pré-existente, fora de escopo). `TASK_BLOCKED`
   entra nesse array + seu próprio `EVENT_LABEL` nessa tela, pra que o escritório possa customizar a
   mensagem de WhatsApp/E-mail, não só ligar/desligar — consistente com o pedido de controle do
   usuário.
4. `apps/api/src/workers/notification.worker.ts`'s `EVENT_FLAG_MAP` (já coberto na seção anterior) —
   tipado `Record<string, keyof NotificationConfig>`, não é `Record<NotificationEvent, ...>`, então o
   TypeScript não obriga a entrada — esquecer aqui silenciosamente faz `isEnabled` cair em `false`
   pra sempre (`?? false` no fallback), a notificação nunca dispara apesar do toggle ligado.
5. `apps/api/src/lib/default-templates.ts`'s `DEFAULT_TEMPLATES` (já coberto na seção anterior) —
   usado como fallback enquanto a org não customizar via (3). Este é o único dos cinco pontos que o
   **compilador obriga**: `DEFAULT_TEMPLATES` é tipado `Record<NotificationEvent, ...>`, então
   esquecer `TASK_BLOCKED` aqui quebra o build assim que o enum ganhar o valor novo — os outros
   quatro pontos (1, 2, 3, 4) são todos objetos/arrays soltos sem checagem contra o enum, e é
   exatamente aí que um esquecimento passaria despercebido até alguém testar manualmente.

**Fora de escopo, registrar como débito técnico separado (não é desta feature, achado faz parte da
revisão):** `recurringGenerationFailed` e `documentRejected` não têm toggle nenhum na UI de
Configurações (nem em `Notifications.tsx`, nem como entrada em `updateConfigSchema`) — ficam travados
no default `true` do banco pra sempre, sem o escritório poder desligar. `Templates.tsx`'s `EVENTS`
também não cobre `REQUEST_CREATED`/`REQUEST_APPROVED`/`REQUEST_REJECTED`/
`RECURRING_GENERATION_FAILED`/`DOCUMENT_REJECTED` — cinco eventos sem editor de mensagem customizada,
só o template padrão do sistema. Vale uma tarefa própria pra nivelar todos os eventos ao mesmo nível
de controle (toggle + mensagem customizável), já que o usuário valoriza esse controle explicitamente.

---

## Resumo das migrações necessárias

1. `ALTER TYPE "NotificationEvent" ADD VALUE 'TASK_BLOCKED'` + `ALTER TABLE "notification_configs"
   ADD COLUMN "taskBlocked" BOOLEAN NOT NULL DEFAULT true` (uma migration, duas instruções — a
   primeira não é usada na mesma migration, mesma regra já seguida antes).

## Testes esperados

- `notifyIfBlocked`: dispara `TASK_BLOCKED` quando `previousStatus !== 'BLOCKED'` e
  `newStatus === 'BLOCKED'`; não dispara quando já estava `BLOCKED`; não dispara quando sai de
  `BLOCKED` pra outro status; respeita `config.taskBlocked = false` (não envia).
- Os três call sites (`recalculateTaskStatus`, `moveTask`, `updateTask`) cada um com um teste
  confirmando que a transição PARA `BLOCKED` por aquele caminho específico dispara a notificação.
- `buildCalendarGrid`: tarefa sem `targetDate` nem `dueDate` não aparece; tarefa com só `dueDate`
  cai no dia certo; grade cobre semanas completas incluindo dias do mês vizinho; mais de 2 tarefas
  no mesmo dia produz o "+N mais" corretamente; uma tarefa com `targetDate` em UTC-midnight cai no
  dia certo independente do fuso horário do ambiente de teste (regressão específica pro bug de
  fuso-horário descrito acima).
- `PATCH /notifications/config` com `{ taskBlocked: false }` realmente persiste `false` (não só
  passa na validação — confirmar lendo de volta via `GET /notifications/config` depois do PATCH),
  prova direta de que `updateConfigSchema` inclui o campo novo.
- E2E: opcionalmente, um teste cobrindo a troca pro modo Calendário na tela Tarefas (navegação básica
  + clique numa tarefa abre o drawer) — avaliar custo/benefício na hora de escrever o plano, já que
  os specs Playwright existentes são poucos e focados em fluxos críticos (login, board, portal).
