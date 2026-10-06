# Geração de Tarefas Recorrentes — Vencimento como Âncora + Gestão em Lote — Design

## Objetivo

Corrige um defeito conceitual grave no motor de recorrência (`docs/superpowers/specs/2026-09-20-recurring-tasks-design.md`): hoje o sistema trata **competência** como a âncora do cálculo de datas e deriva o **vencimento** a partir dela (`vencimento = competência + dueMonthOffset`). Na prática do escritório contábil, é o inverso — o vencimento é o que nunca pode estar errado (gera multa pro cliente se vencer no passado ou for mal calculado), e a competência é só um rótulo derivado dele. Um template de DAS configurado com a semântica atual gerava tarefas **já vencidas no dia em que nasciam**.

Esta spec também resolve duas dores de UX reportadas junto com o bug: o popup atual de "vínculos e geração" não escala (sem busca, sem seleção múltipla, geração um cliente por vez), e não existe um jeito de gerar tarefas de um mês específico fora do ciclo automático do cron (ex: cliente novo pede tarefas de meses anteriores).

Contexto da sessão que originou esta spec: ao investigar por que uma tarefa de "competência outubro" venceu em setembro, dois bugs foram corrigidos isoladamente antes de se perceber que a causa raiz era arquitetural — ver commits `4c27365` (crash de `board` morto, não relacionado), `752b1a7` (campo `priority` em falta) e `4273ef5` (fix pontual de `generationMonthOffset`, que esta spec substitui por um modelo mais correto).

Fica fora desta spec:
- **Periodicidade `WEEKLY`** — não sofre da ambiguidade competência/vencimento (a competência já é a própria semana) e mantém o modelo de cálculo atual sem alteração de semântica.
- Qualquer mudança em `targetOffsetDays`/`targetBusinessDayRoll` (meta interna) — não tocados por esta spec.
- Multar/cobrar automaticamente escritório ou cliente por atraso — fora de escopo, mencionado só como motivação de por que vencimento tem que estar sempre certo.

## Contexto — o que já existe

- `RecurringTaskTemplate` (`apps/api/prisma/schema.prisma:435`) tem os campos de data: `dueMonthOffset`, `dueDayOfPeriod`, `dueBusinessDayRoll`, `targetOffsetDays`, `targetBusinessDayRoll`, `generationMonthOffset`, `generationDayOfPeriod`.
- `recurrence-dates.ts` tem as funções puras de cálculo: `computeDueDate(competence, rules)`, `computeTargetDate(dueDate, rules)`, `computeCompetencesToGenerate(today, rules)`, `computeCurrentPeriodStart`, `normalizeToPeriodStart`. Todas tratam `competence: Date` como a entrada primária.
- `recurring-templates.service.ts`: `generateTaskForAssignment(templateId, assignmentId, competence)` é o core — recebe a competência já calculada, grava `Task.competence = competence` e `Task.dueDate = computeDueDate(competence, rules)`. `generateManually(templateId, assignmentId, organizationId, competenceOverride?)` é o ponto de entrada da geração manual (botão "Gerar agora"), hoje sempre calcula `competence = computeCurrentPeriodStart(hoje)` quando não há override — nunca usa `generationMonthOffset`.
- `workers/recurring-tasks.cron.ts` chama `computeCompetencesToGenerate(today, rules)` diariamente; essa função decide, pro dia de hoje, se é o `generationDayOfPeriod` configurado e, se for, qual(is) competência(s) gerar.
- `RecurringTemplates.tsx` tem `ManageTemplateDialog` — popup que mistura vincular/desvincular cliente, gerar manualmente (1 cliente por vez, sem escolher mês) e log de geração.
- `AppLayout.tsx` — sidebar lista 7 links individuais sob o rótulo "Configurações" (Templates, Notificações, Assinatura, Departamentos, Usuários de Cliente, Tarefas Recorrentes, Templates de OS).
- Teste de regressão que trava o comportamento atual (default `generationMonthOffset=1`, hardcoded até o fix pontual desta sessão): `recurring-tasks.cron.test.ts`, `recurrence-dates.test.ts`.

## Modelo de dados

### `RecurringTaskTemplate` — campo removido e campo novo

```prisma
model RecurringTaskTemplate {
  // ...campos existentes sem mudança: title, description, periodicity, priority,
  // dueDayOfPeriod, dueBusinessDayRoll, targetOffsetDays, targetBusinessDayRoll,
  // generationDayOfPeriod, generationMonthOffset (mantém o campo, muda a âncora — ver abaixo)...

  // REMOVIDO: dueMonthOffset

  competenceMonthOffset Int @default(1)  // NOVO — quantos meses ANTES do vencimento fica a competência
}
```

**Migração**: `DROP COLUMN "dueMonthOffset"`, `ADD COLUMN "competenceMonthOffset" INTEGER NOT NULL DEFAULT 1`. Sem backfill necessário além do default — nenhum template em produção tinha uma configuração de `dueMonthOffset` que fizesse sentido preservar (o próprio bug que motivou esta spec é prova disso).

**`generationMonthOffset` muda de significado, não de tipo/nome**: antes de qualquer fix desta sessão, media "quantos meses depois do mês do gatilho fica a competência" (e era ignorado pelo código). Depois desta spec, mede **quantos meses antes do vencimento o cron deve disparar** — a mesma ideia de antecedência, mas ancorada no vencimento (que agora é o conceito primário) em vez de numa competência abstrata.

## Modelo de cálculo (`recurrence-dates.ts`)

### Periodicidades `MONTHLY` / `QUARTERLY` / `ANNUAL` — reescritas

Novo fluxo, em duas funções puras novas que substituem o uso de `computeDueDate`/`computeCompetencesToGenerate` pra essas 3 periodicidades:

```ts
/** Vencimento a partir do mês-alvo já decidido (não mais a partir de uma competência). */
function computeDueDateFromMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  const year = dueMonthStart.getUTCFullYear()
  const month = dueMonthStart.getUTCMonth()
  const day = clampDayOfMonth(year, month, rules.dueDayOfPeriod)
  const due = new Date(Date.UTC(year, month, day))
  return rollToBusinessDay(due, rules.dueBusinessDayRoll)
}

/** Competência derivada do mês de vencimento — sempre `competenceMonthOffset` meses antes. */
function computeCompetenceFromDueMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  return addMonthsUTC(dueMonthStart, -rules.competenceMonthOffset)
}

/**
 * Pro cron: decide, pro dia de hoje, quais meses de VENCIMENTO devem ser gerados.
 * Substitui `computeCompetencesToGenerate` pras periodicidades MONTHLY/QUARTERLY/ANNUAL —
 * mesma estrutura de gatilho (dispara só no dia `generationDayOfPeriod`), mas o mês
 * resultante agora representa o vencimento, não mais uma competência hardcoded a +1 mês.
 */
function computeDueMonthsToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const dueMonthStart = addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)

  switch (rules.periodicity) {
    case 'MONTHLY':
      return [dueMonthStart]
    case 'QUARTERLY':
      return dueMonthStart.getUTCMonth() % 3 === 0 ? [dueMonthStart] : []
    case 'ANNUAL':
      return dueMonthStart.getUTCMonth() === 0 ? [dueMonthStart] : []
    case 'WEEKLY':
      throw new Error('WEEKLY usa computeCompetencesToGenerate, não esta função')
  }
}
```

**Exemplo (caso DAS da sessão)**: `generationDayOfPeriod=20`, `generationMonthOffset=1`, `dueDayOfPeriod=10`, `competenceMonthOffset=1`. Cron dispara 20/setembro → `dueMonthStart` = outubro → vencimento = **10/outubro** → competência = outubro - 1 = **setembro**. Bate com o exemplo validado na conversa.

### Periodicidade `WEEKLY` — inalterada

Mantém `computeCompetencesToGenerate`, `computeDueDate` (ramo `WEEKLY`) e `computeCurrentPeriodStart` exatamente como estão hoje pra essa periodicidade — "competência" continua sendo a segunda-feira da semana, vencimento continua `competence + (dueDayOfPeriod - 1) dias`. `competenceMonthOffset` é ignorado quando `periodicity === 'WEEKLY'` (não existe "mês antes" pra uma semana).

### `computeTargetDate` — inalterada

Já opera em cima do `dueDate` calculado, não precisa saber como o `dueDate` foi obtido.

## Camada de serviço (`recurring-templates.service.ts`)

### `generateTaskForAssignment` — assinatura muda

```ts
// Antes: generateTaskForAssignment(templateId, assignmentId, competence: Date)
// Depois:
export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  dueMonth: Date,  // primeiro dia do mês de vencimento (MONTHLY/QUARTERLY/ANNUAL) ou a própria competência-semana (WEEKLY, sem mudança de significado nesse caso)
): Promise<GenerationOutcome>
```

Internamente: pra periodicidades não-`WEEKLY`, `dueDate = computeDueDateFromMonth(dueMonth, rules)` e `competence = computeCompetenceFromDueMonth(dueMonth, rules)` (o que é gravado em `Task.competence` continua sendo a competência, só que agora derivada — nenhuma mudança no schema de `Task` nem nos outros lugares do app que leem `Task.competence`, ex. filtros de calendário). Pra `WEEKLY`, `dueMonth` É a competência (mantém contrato atual) e `dueDate = computeDueDate(dueMonth, rules)` (ramo weekly).

A chave de idempotência (`recurringGenerationLog`, `@@unique([templateId, clientId, competence])`) continua baseada em `competence` — não muda, já é granular o suficiente (uma competência derivada ainda é determinística a partir do `dueMonth` + config do template).

### `generateManually` — parâmetro renomeado e ressignificado

```ts
// Antes: generateManually(templateId, assignmentId, organizationId, competenceOverride?: string)
// Depois:
export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  dueMonthOverride?: string,  // string ISO; se omitido, usa o próximo ciclo normal do template (mesma conta do cron)
)
```

Quando `dueMonthOverride` é omitido: calcula o próximo `dueMonth` normal do template a partir de hoje, usando a mesma fórmula do cron (`addMonthsUTC(startOfMonthUTC(hoje), generationMonthOffset)` pra não-WEEKLY, ou `computeCurrentPeriodStart` pra WEEKLY) — ou seja, "Gerar agora" sem escolher mês continua fazendo "o que o cron faria no próximo disparo", não mais "o mês atual cru" como hoje.

### Novo: `generateBulkForTemplate`

```ts
export interface BulkGenerationResult {
  generated: number
  alreadyExists: number
  failed: { clientName: string; errorMessage: string }[]
}

export async function generateBulkForTemplate(
  templateId: string,
  organizationId: string,
  dueMonth: string,          // ISO date dentro do mês de vencimento alvo
  assignmentIds: string[],   // seleção do checkbox na tela
): Promise<BulkGenerationResult>
```

Itera os `assignmentIds`; qualquer ID que não pertença a esse `templateId`/organização é **ignorado silenciosamente** (não entra em `failed[]` — não é uma falha de geração, é um ID inválido que não deveria ter chegado ali, e travar o lote inteiro por isso seria pior que ignorar). Pra cada assignment válido, chama `generateTaskForAssignment`, categoriza o resultado (`SUCCESS` → `generated++`, `ALREADY_EXISTS` → `alreadyExists++`, `FAILED` → entra em `failed[]` com o nome do cliente) — **nunca lança exceção por causa de um item individual**, processa a lista inteira e retorna o resumo agregado.

### Novo: `generateBulkForAllTemplates`

```ts
export interface BulkGenerationSummary {
  templateId: string
  templateTitle: string
  result: BulkGenerationResult
}

export async function generateBulkForAllTemplates(
  organizationId: string,
  dueMonth: string,
): Promise<BulkGenerationSummary[]>
```

Busca todos os templates `isActive: true` da org, pra cada um busca todos os `assignments` com `isActive: true`, roda a mesma lógica de `generateBulkForTemplate` com a seleção completa. Retorna um array, um item por template (inclusive os que geraram 0, pra transparência).

### `listAssignments` — ganha busca por nome

```ts
export async function listAssignments(templateId: string, organizationId: string, search?: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringTaskAssignment.findMany({
    where: {
      templateId,
      ...(search ? { client: { name: { contains: search, mode: 'insensitive' } } } : {}),
    },
    include: { client: { select: { id: true, name: true, codigo: true } } },
    orderBy: { createdAt: 'asc' },
  })
}
```

Mesmo padrão de `contains`/`insensitive` já usado em `/clients` e `/tasks` (`q` param).

## Endpoints novos/alterados (`recurring-templates.routes.ts`)

```
GET  /recurring-templates/:id/assignments?q=nome        — já existe, ganha ?q opcional
POST /recurring-templates/:id/assignments/bulk-generate — NOVO
     Body: { dueMonth: string (ISO), assignmentIds: string[] }
     Response: BulkGenerationResult
     Auth: mesmo preHandler das outras rotas de template (verifyJWT + verifyOrg + requireRole ORG_ADMIN) + checkSubscription (é mutação)

POST /recurring-templates/bulk-generate                 — NOVO
     Body: { dueMonth: string (ISO) }
     Response: BulkGenerationSummary[]
     Auth: igual acima, roda pra TODOS os templates da org — sem parâmetro de seleção de template/cliente

POST /recurring-templates/:id/assignments/:assignmentId/generate — já existe, body muda de
     { competence?: string } para { dueMonth?: string }
```

Validação Zod (`recurring-templates.schema.ts`):

```ts
export const bulkGenerateSchema = z.object({
  dueMonth: z.string().datetime(),
  assignmentIds: z.array(z.string().cuid()).min(1, 'Selecione ao menos um cliente'),
})

export const bulkGenerateAllSchema = z.object({
  dueMonth: z.string().datetime(),
})

export const manualGenerateSchema = z.object({
  dueMonth: z.string().datetime().optional(),  // renomeado de `competence`
})
```

## Frontend

### Tela 1 — Gestão do template (`/app/settings/recurring-templates/:id/manage`)

Substitui `ManageTemplateDialog` por uma página própria (`RecurringTemplateManage.tsx`). Navegação: o botão "Vínculos e log" na listagem (`RecurringTemplates.tsx`) troca de `onClick={() => setManaging(t)}` pra `<Link to={...manage}>`.

Seções da página, de cima pra baixo:
1. Header: título do template + link "← Tarefas Recorrentes"
2. Seletor de mês de vencimento (`<input type="month">` ou equivalente), default = próximo ciclo normal do template (mesmo cálculo do `generateManually` sem override)
3. Campo de busca por nome (`?q=`, debounced, reflete na listagem abaixo)
4. Lista de clientes vinculados: checkbox + "código - nome" + status da competência correspondente ao mês selecionado (ex: "Gerado 10/10", "Pendente", "Falhou: <motivo>") + botão de desvincular individual
5. "Selecionar todos" / "Limpar seleção" (opera sobre os itens filtrados visíveis, não a lista inteira se houver busca ativa)
6. Botão "Gerar selecionados" → `POST .../bulk-generate` com o mês escolhido e os IDs marcados; mostra toast com o resumo (ex: "3 geradas, 1 já existia")
7. Formulário de vincular novo cliente (reaproveita o que já existe no popup)
8. Log de geração (reaproveita a lista que já existe no popup, sem mudança)

### Tela 2 — Console global (`/app/settings/recurring-generation`)

Página nova (`RecurringGenerationConsole.tsx`), pensada como ferramenta de exceção (recuperar cron que falhou, adiantar o mês inteiro), não uso diário:
1. Seletor de mês de vencimento
2. Lista de templates ativos (nome, periodicidade, departamento) — sem seleção de cliente, é tudo-ou-nada por template
3. Botão "Gerar todos" → `POST /recurring-templates/bulk-generate` com o mês escolhido
4. Resultado exibido inline por template (não só toast, porque pode ser uma lista longa): nome do template + "N geradas / M já existiam / K falharam", expansível pra ver os nomes dos clientes que falharam

### Tela 3 — Hub de Configurações (`/app/settings`)

Página nova (`SettingsHub.tsx`) com grid de cards, um por seção: Templates, Notificações, Assinatura, Departamentos, Usuários de Cliente, Tarefas Recorrentes, Templates de OS, **Geração manual** (novo, leva pro console global). Cada card: ícone (reaproveita os já usados na sidebar hoje) + título + descrição curta de uma linha.

`AppLayout.tsx`: os 7 `SidebarLink` individuais sob `SidebarSectionLabel('Configurações')` são substituídos por um único `SidebarLink to="/app/settings" icon={<Settings />} label="Configurações"`. Páginas individuais (`RecurringTemplates.tsx`, `Departments.tsx`, etc.) ganham um link "← Configurações" no topo pra navegação de volta, já que a sidebar não aponta mais pra elas diretamente.

## Testes — pontos de atenção

- `recurrence-dates.test.ts`: os testes atuais de `computeDueDate`/`computeCompetencesToGenerate` pra MONTHLY/QUARTERLY/ANNUAL usando `dueMonthOffset` deixam de existir (função removida) — substituídos por testes de `computeDueDateFromMonth`/`computeCompetenceFromDueMonth`/`computeDueMonthsToGenerate`. Os testes de WEEKLY continuam valendo sem alteração.
- `recurring-templates.service.test.ts`: fixtures que usam `priority`/`periodicity` (adicionadas/ajustadas nesta sessão) agora também trocam `dueMonthOffset` por `competenceMonthOffset`. Novo teste cobrindo o caso DAS completo: gera com `dueMonth` explícito, confirma `task.dueDate` e `task.competence` batem com a fórmula.
- Novo arquivo ou seção de testes pra `generateBulkForTemplate`/`generateBulkForAllTemplates`: caso com mistura de sucesso/já-existe/falha no mesmo lote, confirma que um item falho não derruba os outros.
- `recurring-tasks.cron.test.ts`: ajusta fixtures (sem `dueMonthOffset`), confirma que o cron ainda dispara certo com o novo `computeDueMonthsToGenerate`.
- Teste de regressão explícito pro bug original: template com `generationDayOfPeriod=20`, `generationMonthOffset=1`, `dueDayOfPeriod=10`, `competenceMonthOffset=1`, disparo em 20/set → `dueDate` = 10/out, `competence` = 01/set.
- Frontend: smoke test (Playwright, como já foi feito nas sessões anteriores) da Tela 1 — marcar 2 clientes, gerar, conferir toast de resumo; e da Tela 3 — hub carrega os 8 cards e navega certo.

## Review Focus

- **Vencimento nunca no passado em relação a hoje, no fluxo automático do cron**: com `generationMonthOffset >= 1` (nunca 0 seria o caso de risco, mas um operador pode configurar 0 por engano) — vale validação no schema Zod: alertar/bloquear `generationMonthOffset=0` seria gerar o mês corrente, que pode já ter passado o dia de vencimento dependendo do `dueDayOfPeriod` configurado. Decisão: **não bloquear no schema** (pode ser caso de uso legítimo pra ciclos curtos), mas o form do frontend mostra um aviso quando `generationMonthOffset=0`.
- **Geração em lote parcialmente falha não deve reverter os sucessos**: já coberto pelo desenho de `generateBulkForTemplate`/`generateBulkForAllTemplates` (processamento item a item, sem transação única cobrindo o lote inteiro).
- **Busca por nome na Tela 1 some com clientes que tem tarefa já gerada**: a busca filtra só por nome, nunca deve esconder itens baseado em status de geração — só o texto digitado afeta a lista.
- **`competenceMonthOffset` configurado maior que o próprio ciclo de periodicidade** (ex: QUARTERLY com `competenceMonthOffset=12`) — não há validação hoje impedindo um valor "sem sentido". Decisão: aceitar qualquer inteiro ≥ 0, sem validação de coerência — é uma config avançada, e o preview no form (mostrar o exemplo calculado) é a proteção suficiente, não uma trava rígida.
- **Templates `WEEKLY` na Tela 1/2**: o seletor de mês ainda precisa funcionar pra eles (gera todas as semanas daquele mês, reaproveitando a janela que `computeCompetencesToGenerate` já calcula) — não ficam de fora das telas novas, só do novo modelo de cálculo mensal.
