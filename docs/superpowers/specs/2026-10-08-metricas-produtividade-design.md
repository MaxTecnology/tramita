# Métricas de Produtividade — Design

> Item 4 do roadmap de sub-projetos ativos (`docs/TASKS.md`). Dependia dos itens 2 (motor de
> recorrência) e 3 (SLA/alertas de prazo) existirem primeiro — ambos concluídos.

## Objetivo

Dar visibilidade de produtividade por pessoa e por departamento, cruzando tarefas de board `OS` e
`RECURRING_SYSTEM`, com cinco frentes de métrica: volume, cumprimento de prazo (meta e
vencimento), tempo médio de conclusão (+ sinal de fechamento tardio), carga atual, e impedimento.
Gestão (`ORG_ADMIN`/`ORG_MANAGER`) vê tudo; colaborador (`ORG_MEMBER`) vê só o próprio desempenho.

## Decisões de escopo (fechadas em brainstorming)

| Decisão | Escolha |
|---|---|
| Público | Gestão vê tudo; `ORG_MEMBER` vê só a própria produtividade |
| Escopo de tarefas | OS + Recorrente, sempre distinguíveis (nunca só um número agregado) |
| Localização | Abas no `DashboardMetrics.tsx` existente: "Visão geral" (KPIs de hoje) + "Produtividade" (novo) |
| Cumprimento de prazo | Dois números separados: meta (`targetDate`) e vencimento (`dueDate`) |
| Meta como base futura | Serve de insumo pra uma futura função de comissão/premiação — não construída agora |
| Tempo médio de conclusão | `completedAt - createdAt`; métrica separada (não misturada) de "fechamento tardio" |
| Fechamento tardio | Alerta só visual na tela de métricas (não vira notificação push, evita duplicar o sistema de SLA) |
| Impedimento | Contagem de tarefas com pelo menos 1 período `BLOCKED` + tempo total somando todos os períodos |
| Motivo do impedimento | Não categorizado (sem campo de motivo livre hoje — seria trabalho adicional sem necessidade clara) |
| Escopo impedimento/fechamento tardio | OS + Recorrente, mesma simetria das outras métricas |
| Filtro de período | Presets (7/30/90 dias, mês atual) + intervalo customizado |
| Threshold de fechamento tardio | Configurável por organização (`lateClosureThresholdDays`), não fixo no código |

## Arquitetura

### 1. Correções de base (pré-requisito pras métricas de tempo)

Hoje não existe nenhum campo de "quando a tarefa foi concluída" — só histórico (`TaskHistory`),
inconsistente entre os dois caminhos que mudam `status`:

- `updateTask` grava `action: 'status_changed'` no histórico quando `data.status` muda.
- `moveTask` muda `status` via `Column.statusEffect`, mas só grava `action: 'moved_to'` — nunca
  `status_changed`. Reconstruir "quando a tarefa ficou `DONE`/`BLOCKED`" a partir disso exigiria
  saber qual era o `statusEffect` da coluna de destino *no momento da mudança*, que pode ter sido
  reconfigurado depois — não confiável retroativamente.

**Correção, `apps/api/src/modules/tasks/tasks.service.ts`:**

- `moveTask` passa a gravar `status_changed` (`fromValue`/`toValue` = status antigo/novo) sempre
  que `nextStatus !== task.status`, além do `moved_to` que já grava hoje. Unifica os dois
  caminhos — daqui pra frente, toda mudança de status real tem exatamente 1 entrada
  `status_changed` confiável no histórico, independente de ter sido via edição direta ou
  arrastando no Kanban.

**Schema**, `apps/api/prisma/schema.prisma`:

```prisma
model Task {
  // ...campos existentes...
  completedAt DateTime?
}
```

- Setado em `updateTask`/`moveTask` sempre que o novo status é `DONE` (e o antigo não era).
- Limpo (`null`) se a tarefa sair de `DONE` de volta pra qualquer outro status (ex: reaberta).
- **Não** é adicionado nenhum campo de tempo de impedimento — é derivado por consulta aos pares
  `status_changed` (`toValue: 'BLOCKED'` → próxima entrada com `fromValue: 'BLOCKED'`) no momento
  do cálculo da métrica, somando todos os períodos. Uma tarefa ainda bloqueada no momento da
  consulta (sem entrada de saída) conta o período parcial até `now`.

### 2. Config por organização

`NotificationConfig` (reaproveitando o model que já guarda `slaTargetWarningDays` etc. — é onde
este tipo de configuração operacional da org já vive) ganha:

```prisma
lateClosureThresholdDays Int @default(2)
```

Editável em Configurações, mesmo padrão dos campos de SLA.

### 3. Módulo `metrics` (backend)

Novo módulo `src/modules/metrics/`:

```
src/modules/metrics/
  metrics.routes.ts
  metrics.service.ts
  metrics.schema.ts
```

**Endpoint único**: `GET /metrics/productivity`

**Query params** (`metrics.schema.ts`):

```typescript
export const productivityQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  departmentId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  boardType: z.enum(['OS', 'RECURRING_SYSTEM']).optional(), // ausente = ambos, distinguidos na resposta
})
```

**Controle de acesso** (`metrics.routes.ts`, preHandler após `verifyJWT`):

```typescript
app.get('/productivity', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
  const result = productivityQuerySchema.safeParse(request.query)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)

  const query = result.data
  if (request.user.role === 'ORG_MEMBER') {
    // ORG_MEMBER nunca vê produtividade de outra pessoa — nem por tentativa direta (userId de
    // outro usuário), nem indiretamente via quebra "por pessoa" de um departamento com vários
    // membros. A query força o próprio id e a resposta final só retorna a própria linha na
    // quebra por pessoa, independente de departmentId ser informado.
    query.userId = request.user.sub
  }

  return reply.send(await getProductivityMetrics(request.user.organizationId!, query))
})
```

**Cálculo** (`metrics.service.ts`) — pseudocódigo da forma geral, sem acumular linha por linha em
JS (uma query agrupada, não N+1):

```typescript
export async function getProductivityMetrics(organizationId: string, query: ProductivityQuery) {
  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  const lateClosureThresholdDays = config?.lateClosureThresholdDays ?? 2

  const where: Prisma.TaskWhereInput = {
    column: {
      board: {
        organizationId,
        ...(query.boardType ? { type: query.boardType } : {}),
      },
    },
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.userId ? { assigneeId: query.userId } : {}),
  }

  // Volume + prazo + tempo de conclusão: tarefas concluídas dentro do período
  const completedTasks = await prisma.task.findMany({
    where: { ...where, completedAt: { gte: new Date(query.from), lte: new Date(query.to) } },
    select: {
      id: true, createdAt: true, completedAt: true, targetDate: true, dueDate: true,
      assigneeId: true, departmentId: true,
      column: { select: { board: { select: { type: true } } } },
    },
  })

  // Carga atual: sem filtro de período, foto de agora
  const openTasks = await prisma.task.findMany({
    where: { ...where, status: { notIn: ['DONE', 'DISREGARDED'] } },
    select: { assigneeId: true, departmentId: true, column: { select: { board: { select: { type: true } } } } },
  })

  // Impedimento: busca o histórico de status de todas as tasks candidatas (abertas OU concluídas
  // no período) numa query só, nunca em loop por task
  const history = await prisma.taskHistory.findMany({
    where: {
      action: 'status_changed',
      task: { ...where },
      OR: [{ toValue: 'BLOCKED' }, { fromValue: 'BLOCKED' }],
    },
    select: { taskId: true, fromValue: true, toValue: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // ...agrega completedTasks/openTasks/history em memória (já são os conjuntos filtrados, não
  // precisa de query por task), separando por assigneeId e departmentId, e por column.board.type...
}
```

**Formato de resposta:**

```typescript
interface ProductivityMetrics {
  period: { from: string; to: string }
  byPerson: PersonMetrics[]   // 1 linha só pra ORG_MEMBER
  byDepartment: DepartmentMetrics[]
}

interface MetricsBreakdown {
  volume: { os: number; recurring: number }
  onTimeRate: {
    target: { onTime: number; late: number; applicable: number } | null // null = nenhuma task com targetDate no grupo
    due: { onTime: number; late: number; applicable: number }
  }
  avgCompletionDays: { os: number | null; recurring: number | null }
  lateClosureCount: number // tasks com gap > lateClosureThresholdDays entre última atividade e completedAt
  currentLoad: { os: number; recurring: number }
  blocked: { taskCount: number; totalDays: number }
}

interface PersonMetrics extends MetricsBreakdown { userId: string; userName: string }
interface DepartmentMetrics extends MetricsBreakdown { departmentId: string; departmentName: string }
```

`onTimeRate.target` vem `null` quando o grupo não tem nenhuma tarefa com `targetDate` no período —
o frontend mostra "não aplicável" em vez de 0%, evitando o problema de departamento 100% OS
aparecer com "meta cumprida: 0%".

### 4. Frontend

**`DashboardMetrics.tsx`** ganha abas (mesmo padrão de tabs já usado em `Notifications.tsx`):
"Visão geral" (o conteúdo atual do arquivo, os 4 KPIs, inalterado) e "Produtividade" (tela nova).

**Nova tela de Produtividade** (`apps/web/src/pages/app/Productivity.tsx` ou seção dentro do
próprio `Dashboard.tsx` — decisão de arquivo fica pro plano):

- Filtro de período: botões de preset (7/30/90 dias, mês atual) + dois date pickers pra intervalo
  customizado.
- Seletor de departamento (`ORG_ADMIN`/`ORG_MANAGER` only — `ORG_MEMBER` não vê esse filtro,
  já que o resultado é sempre só dele mesmo).
- Seletor de pessoa (idem — oculto pra `ORG_MEMBER`).
- Toggle OS / Recorrente / Ambos.
- Toggle "ver por pessoa" / "ver por departamento" (tabela troca de dimensão).
- Tabela principal: linhas = pessoa ou departamento (conforme toggle), colunas = volume (OS |
  Recorrente), % meta, % vencimento, tempo médio de conclusão, carga atual, impedimento
  (contagem + dias).
- Lista separada abaixo da tabela: "Tarefas com indício de fechamento tardio" — não misturada nos
  números agregados, cada linha com link pra abrir a tarefa.

## Fora do escopo (v1)

- Comissão/premiação baseada em cumprimento de meta (a métrica já fica pronta pra alimentar isso
  depois, mas a lógica de cálculo de comissão não é construída agora).
- Categorização do motivo do impedimento (ex: qual documento faltando) — sem campo de motivo
  livre hoje.
- Alerta ativo (push/notificação) pra fechamento tardio — só indicador visual na tela de métricas.
- Cache/materialização de métricas — cálculo direto via Prisma a cada request; revisar se volume
  real justificar depois.
- Métricas no portal do cliente final — é só uma visão interna do escritório.

## Revisão própria

- **Placeholders:** nenhum — todo trecho de código é completo ou pseudocódigo explicitamente
  marcado como tal (a função de agregação final, que depende de estruturas de dados já definidas
  acima, não de lógica desconhecida).
- **Consistência:** `completedAt` é a única fonte de verdade pra "quando concluiu", usada tanto no
  cálculo de volume quanto de tempo médio quanto de cumprimento de prazo — nenhuma dessas três
  deriva de lugares diferentes do histórico.
- **Ambiguidade resolvida:** "por departamento" agrupa por `Task.departmentId` (departamento da
  tarefa), não por um departamento "do usuário" — não existe esse conceito no schema (um
  colaborador pode trabalhar em tarefas de departamentos diferentes).
- **Segurança:** `ORG_MEMBER` nunca recebe a quebra "por pessoa" de outro usuário, mesmo
  filtrando por um departamento compartilhado — a trava é no backend (query forçada), não só na
  UI escondendo o seletor.
