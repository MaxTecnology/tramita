# Geração de Tarefas Recorrentes — Vencimento como Âncora + Gestão em Lote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o motor de recorrência pra tratar vencimento (não competência) como âncora do cálculo de datas, e substituir o popup atual de "vínculos e geração" por duas telas (gestão por template + console global) com geração em lote, visibilidade persistente de falhas, e um hub de Configurações.

**Architecture:** Camada pura de datas (`recurrence-dates.ts`) ganha funções novas ancoradas em "mês de vencimento" pras periodicidades MONTHLY/QUARTERLY/ANNUAL; WEEKLY mantém o modelo atual sem mudança de semântica. A camada de serviço (`recurring-templates.service.ts`) reescreve `generateTaskForAssignment`/`generateManually` pra receber `dueMonth` em vez de `competence`, e ganha duas funções novas de geração em lote que nunca lançam exceção por item individual. Três telas novas no frontend consomem os endpoints novos; a sidebar colapsa pra um hub.

**Tech Stack:** Fastify + Prisma + Zod (API), React + React Query + React Router (web) — mesma stack do resto do projeto, sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-06-recurring-generation-redesign-design.md`

## Global Constraints

- Migrations SÓ via `pnpm --filter api migrate:dev -- --name <nome>` (dev) ou `pnpm --filter api migrate:deploy` (test/prod) — nunca `prisma migrate` direto (CLAUDE.md do projeto).
- TypeScript `strict: true`, sem `any`.
- Validação Zod em toda entrada de rota.
- `WEEKLY` nunca muda de semântica nesta spec — qualquer função nova que não sirva pra `WEEKLY` lança erro explícito se chamada com essa periodicidade, em vez de se comportar de forma indefinida.
- Nenhuma falha de geração (lote ou individual) pode ser descartada silenciosamente — toda falha vira uma entrada visível em algum lugar (resposta imediata E `RecurringGenerationLog`).
- Após cada task: `pnpm --filter api exec tsc --noEmit` (ou `web`, conforme o task) e a suíte de testes relevante precisam passar antes de prosseguir.

## Review Focus

- Vencimento calculado a partir de `dueMonth` nunca deve silenciosamente cair num mês errado quando `generationMonthOffset=0` — teste cobrindo esse caso.
- Geração em lote com um item inválido (`assignmentId` que não pertence ao template) não pode derrubar os outros itens válidos do mesmo lote — teste misto.
- `GET /recurring-templates/failed-generations` precisa funcionar mesmo se o `Client` referenciado por um log foi excluído depois — teste com clientId órfão.
- Busca por nome na Tela 1 não pode esconder itens com falha/sucesso — só o texto filtra.
- A rota `GET /recurring-templates/failed-generations` precisa ser registrada ANTES de `GET /recurring-templates/:id` no Fastify, senão `:id` casa com o literal `"failed-generations"` e a rota nunca é alcançada — teste de integração confirmando que o endpoint responde (não cai no handler de `:id` com 404 "Template não encontrado").
- `generateManually` sem `dueMonthOverride` precisa continuar idempotente com o que o cron geraria no próximo disparo normal — teste comparando os dois caminhos pro mesmo template/data.

---

### Task 1: Camada de datas — vencimento como âncora + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:435-470` (model `RecurringTaskTemplate`)
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurrence-dates.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurrence-dates.test.ts`
- Create: migration em `apps/api/prisma/migrations/` (gerada pelo comando, não escrita à mão)

**Interfaces:**
- Produces: `RecurrenceDateRules` sem `dueMonthOffset`, com `competenceMonthOffset: number`. Funções exportadas novas: `computeDueDateFromMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date`, `computeCompetenceFromDueMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date`, `computeDueMonthsToGenerate(today: Date, rules: RecurrenceDateRules): Date[]`, `computeNextDueMonth(today: Date, rules: RecurrenceDateRules): Date`. `computeDueDate` passa a servir só pra `WEEKLY` (lança não é necessário — ela só é chamada pelo caller sabendo que é WEEKLY, mas o corpo não usa mais `dueMonthOffset`). `computeCompetencesToGenerate` passa a lançar erro se `rules.periodicity !== 'WEEKLY'`. `computeCurrentPeriodStart`/`normalizeToPeriodStart` inalteradas.
- Consumes: nada de outras tasks (fundação).

- [ ] **Step 1: Editar o schema Prisma**

Em `apps/api/prisma/schema.prisma`, no model `RecurringTaskTemplate` (linha ~435), trocar:

```prisma
  dueMonthOffset     Int             @default(0)
  dueDayOfPeriod     Int
  dueBusinessDayRoll BusinessDayRoll @default(NONE)
```

por:

```prisma
  dueDayOfPeriod     Int
  dueBusinessDayRoll BusinessDayRoll @default(NONE)

  competenceMonthOffset Int @default(1)
```

(remove a linha `dueMonthOffset`, adiciona `competenceMonthOffset` com default 1 — manter as outras linhas do model intactas, inclusive `generationMonthOffset`/`generationDayOfPeriod` que não mudam de tipo).

- [ ] **Step 2: Rodar a migration**

```bash
pnpm --filter api migrate:dev -- --name due_vs_competence_anchor
```

Quando o prompt pedir confirmação do nome, confirmar `due_vs_competence_anchor`. Verificar que a migration gerada contém `DROP COLUMN "dueMonthOffset"` e `ADD COLUMN "competenceMonthOffset"` (sem mais nada inesperado — se o diff trouxer alguma mudança não relacionada, como já aconteceu antes nesta sessão com uma FK de `tasks.departmentId`, confirmar que é idêntica à atual antes de prosseguir, não é motivo pra abortar).

Depois, aplicar a mesma migration no banco de teste:

```bash
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" pnpm --filter api migrate:deploy
```

- [ ] **Step 3: Atualizar `recurring-templates.schema.ts`**

Em `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`, no `createTemplateSchema`, trocar:

```ts
  dueMonthOffset: z.number().int().min(-12).max(12).default(0),
  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueBusinessDayRoll: z.enum(['NONE', 'FORWARD', 'BACKWARD']).default('NONE'),
```

por:

```ts
  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueBusinessDayRoll: z.enum(['NONE', 'FORWARD', 'BACKWARD']).default('NONE'),

  competenceMonthOffset: z.number().int().min(0).default(1),
```

No final do arquivo, trocar o `manualGenerateSchema` atual:

```ts
export const manualGenerateSchema = z.object({
  competence: z.string().datetime().optional(),
})

export type ManualGenerateBody = z.infer<typeof manualGenerateSchema>
```

por:

```ts
export const manualGenerateSchema = z.object({
  dueMonth: z.string().datetime().optional(),
})

export type ManualGenerateBody = z.infer<typeof manualGenerateSchema>

export const bulkGenerateSchema = z.object({
  dueMonth: z.string().datetime(),
  assignmentIds: z.array(z.string().cuid()).min(1, 'Selecione ao menos um cliente'),
})

export type BulkGenerateBody = z.infer<typeof bulkGenerateSchema>

export const bulkGenerateAllSchema = z.object({
  dueMonth: z.string().datetime(),
})

export type BulkGenerateAllBody = z.infer<typeof bulkGenerateAllSchema>
```

- [ ] **Step 4: Reescrever `recurrence-dates.ts`**

Substituir o conteúdo inteiro de `apps/api/src/modules/recurring-templates/recurrence-dates.ts` por:

```ts
export type Periodicity = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
export type BusinessDayRoll = 'NONE' | 'FORWARD' | 'BACKWARD'

export interface RecurrenceDateRules {
  periodicity: Periodicity
  dueDayOfPeriod: number
  dueBusinessDayRoll: BusinessDayRoll
  competenceMonthOffset: number
  targetOffsetDays: number
  targetBusinessDayRoll: BusinessDayRoll
  generationMonthOffset: number
  generationDayOfPeriod: number
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function rollToBusinessDay(date: Date, direction: BusinessDayRoll): Date {
  if (direction === 'NONE') return date
  const step = direction === 'FORWARD' ? 1 : -1
  const result = new Date(date)
  while (isWeekend(result)) {
    result.setUTCDate(result.getUTCDate() + step)
  }
  return result
}

function clampDayOfMonth(year: number, monthIndex: number, day: number): number {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, daysInMonth)
}

function addMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/** Segunda-feira da semana ISO em que `date` cai (ou a própria data, se já for segunda). */
function mondayOfWeek(date: Date): Date {
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay() // 1=segunda..7=domingo
  return addDaysUTC(date, 1 - isoDay)
}

/**
 * Vencimento pra periodicidade WEEKLY — a única que ainda usa "competência" como entrada
 * primária (a competência É a segunda-feira da semana, não existe ambiguidade com vencimento
 * nesse caso, por isso essa periodicidade ficou fora do redesenho vencimento-como-âncora).
 */
export function computeDueDate(competence: Date, rules: RecurrenceDateRules): Date {
  const due = addDaysUTC(competence, rules.dueDayOfPeriod - 1)
  return rollToBusinessDay(due, rules.dueBusinessDayRoll)
}

/**
 * Vencimento a partir do mês-alvo já decidido — usada por MONTHLY/QUARTERLY/ANNUAL, onde
 * vencimento é a âncora (não mais derivado de uma "competência" abstrata).
 */
export function computeDueDateFromMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  const year = dueMonthStart.getUTCFullYear()
  const month = dueMonthStart.getUTCMonth()
  const day = clampDayOfMonth(year, month, rules.dueDayOfPeriod)
  const due = new Date(Date.UTC(year, month, day))
  return rollToBusinessDay(due, rules.dueBusinessDayRoll)
}

/** Competência derivada do mês de vencimento — sempre `competenceMonthOffset` meses antes. */
export function computeCompetenceFromDueMonth(dueMonthStart: Date, rules: RecurrenceDateRules): Date {
  return addMonthsUTC(dueMonthStart, -rules.competenceMonthOffset)
}

export function computeTargetDate(dueDate: Date, rules: RecurrenceDateRules): Date {
  const target = addDaysUTC(dueDate, rules.targetOffsetDays)
  return rollToBusinessDay(target, rules.targetBusinessDayRoll)
}

/**
 * Pro cron: decide, pro dia de hoje, quais meses de VENCIMENTO devem ser gerados.
 * Só serve pras periodicidades MONTHLY/QUARTERLY/ANNUAL — WEEKLY usa `computeCompetencesToGenerate`
 * (ver abaixo), porque pra ela "mês de vencimento" não é um conceito que faça sentido isolado
 * (uma semana pode atravessar dois meses).
 */
export function computeDueMonthsToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  if (rules.periodicity === 'WEEKLY') {
    throw new Error('WEEKLY usa computeCompetencesToGenerate, não computeDueMonthsToGenerate')
  }

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
  }
}

/**
 * Pro cron: decide quais competências (semanas) gerar hoje — só serve pra WEEKLY.
 * MONTHLY/QUARTERLY/ANNUAL usam `computeDueMonthsToGenerate`.
 */
export function computeCompetencesToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  if (rules.periodicity !== 'WEEKLY') {
    throw new Error('computeCompetencesToGenerate só serve pra WEEKLY — use computeDueMonthsToGenerate pras demais periodicidades')
  }

  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const competenceMonthStart = addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)
  const competenceMonthEnd = addMonthsUTC(competenceMonthStart, 1)
  const competences: Date[] = []
  let cursor = mondayOfWeek(competenceMonthStart)
  if (cursor < competenceMonthStart) cursor = addDaysUTC(cursor, 7)
  while (cursor < competenceMonthEnd) {
    competences.push(cursor)
    cursor = addDaysUTC(cursor, 7)
  }
  return competences
}

/**
 * Início do período de competência corrente (não o próximo) — usado só pela
 * geração manual, que não espera o gatilho `generationDayOfPeriod` bater; o
 * operador escolhe rodar na hora, pro período que está valendo hoje.
 */
export function computeCurrentPeriodStart(today: Date, periodicity: Periodicity): Date {
  switch (periodicity) {
    case 'MONTHLY':
      return startOfMonthUTC(today)
    case 'WEEKLY':
      return mondayOfWeek(today)
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3
      return new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1))
    }
    case 'ANNUAL':
      return new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  }
}

/**
 * Dado um instante arbitrário (não necessariamente "hoje"), retorna o início canônico do
 * período (semana/mês/trimestre/ano) em que ele cai. Usado pra canonicalizar um override
 * arbitrário vindo da API (geração manual/lote) pra bater com a chave de idempotência que
 * o cron geraria pro mesmo período real.
 */
export function normalizeToPeriodStart(date: Date, periodicity: Periodicity): Date {
  return computeCurrentPeriodStart(date, periodicity)
}

/**
 * Mês de vencimento do "próximo ciclo normal" do template, a partir de hoje — mesma conta
 * que o cron usaria se disparasse hoje, mas sem exigir que hoje seja o generationDayOfPeriod.
 * Usado por `generateManually` quando o operador não escolhe um mês explícito: "Gerar agora"
 * sem seletor deve fazer o que o cron faria no próximo disparo, não um "mês atual" cru.
 */
export function computeNextDueMonth(today: Date, rules: RecurrenceDateRules): Date {
  if (rules.periodicity === 'WEEKLY') return computeCurrentPeriodStart(today, rules.periodicity)
  return addMonthsUTC(startOfMonthUTC(today), rules.generationMonthOffset)
}
```

- [ ] **Step 5: Reescrever `recurrence-dates.test.ts`**

Substituir o conteúdo inteiro de `apps/api/src/modules/recurring-templates/recurrence-dates.test.ts` por:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeDueDate,
  computeDueDateFromMonth,
  computeCompetenceFromDueMonth,
  computeTargetDate,
  computeCompetencesToGenerate,
  computeDueMonthsToGenerate,
  computeCurrentPeriodStart,
  normalizeToPeriodStart,
  computeNextDueMonth,
  type RecurrenceDateRules,
} from './recurrence-dates'

const monthlyRules: RecurrenceDateRules = {
  periodicity: 'MONTHLY',
  competenceMonthOffset: 1,
  dueDayOfPeriod: 15,
  dueBusinessDayRoll: 'NONE',
  targetOffsetDays: -2,
  targetBusinessDayRoll: 'NONE',
  generationMonthOffset: 1,
  generationDayOfPeriod: 20,
}

describe('computeDueDateFromMonth', () => {
  it('mensal: mês de vencimento março, dia 15', () => {
    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const due = computeDueDateFromMonth(dueMonth, monthlyRules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('trimestral: mês de vencimento março, dia 10', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY', dueDayOfPeriod: 10 }
    const dueMonth = new Date(Date.UTC(2026, 2, 1))
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-10')
  })

  it('ajusta pro próximo dia útil quando dueBusinessDayRoll=FORWARD e a data cai num sábado', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 14, dueBusinessDayRoll: 'FORWARD' }
    const dueMonth = new Date(Date.UTC(2026, 2, 1)) // 14 de março de 2026 é sábado
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.getUTCDay()).not.toBe(0)
    expect(due.getUTCDay()).not.toBe(6)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('antecipa pro dia útil anterior quando dueBusinessDayRoll=BACKWARD e a data cai num domingo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 20, dueBusinessDayRoll: 'BACKWARD' }
    const dueMonth = new Date(Date.UTC(2026, 8, 1)) // setembro/2026 — dia 20 é domingo
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-09-18')
  })

  it('ajusta o dia pro último dia do mês quando dueDayOfPeriod excede os dias do mês', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 31 }
    const dueMonth = new Date(Date.UTC(2026, 3, 1)) // abril, 30 dias
    const due = computeDueDateFromMonth(dueMonth, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-04-30')
  })
})

describe('computeCompetenceFromDueMonth', () => {
  it('competência = mês de vencimento - competenceMonthOffset', () => {
    const dueMonth = new Date(Date.UTC(2026, 9, 1)) // outubro
    const competence = computeCompetenceFromDueMonth(dueMonth, { ...monthlyRules, competenceMonthOffset: 1 })
    expect(competence.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('competenceMonthOffset=0: competência igual ao mês de vencimento', () => {
    const dueMonth = new Date(Date.UTC(2026, 9, 1))
    const competence = computeCompetenceFromDueMonth(dueMonth, { ...monthlyRules, competenceMonthOffset: 0 })
    expect(competence.toISOString().slice(0, 10)).toBe('2026-10-01')
  })
})

describe('computeTargetDate', () => {
  it('meta = vencimento + targetOffsetDays (negativo = antes)', () => {
    const due = new Date(Date.UTC(2026, 2, 15))
    const target = computeTargetDate(due, monthlyRules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-13')
  })

  it('ajusta a meta pro próximo dia útil independente do ajuste do vencimento', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, targetOffsetDays: -1, targetBusinessDayRoll: 'FORWARD' }
    const due = new Date(Date.UTC(2026, 2, 16)) // segunda -> meta cai domingo 15
    const target = computeTargetDate(due, rules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-16')
  })
})

describe('computeDueMonthsToGenerate', () => {
  it('mensal: dispara só no dia configurado, gera 1 mês de vencimento (gatilho + generationMonthOffset)', () => {
    const trigger = new Date(Date.UTC(2026, 0, 20))
    const notTrigger = new Date(Date.UTC(2026, 0, 19))
    expect(computeDueMonthsToGenerate(trigger, monthlyRules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01'])
    expect(computeDueMonthsToGenerate(notTrigger, monthlyRules)).toEqual([])
  })

  it('generationMonthOffset=0 gera o mês de vencimento no próprio mês do gatilho', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, generationMonthOffset: 0 }
    const trigger = new Date(Date.UTC(2026, 8, 20))
    expect(computeDueMonthsToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-09-01'])
  })

  it('trimestral: só gera quando o mês de vencimento calculado inicia um trimestre novo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY' }
    const triggersNewQuarter = new Date(Date.UTC(2025, 11, 20)) // dezembro -> +1 mês = janeiro (Q1)
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20)) // janeiro -> +1 mês = fevereiro
    expect(computeDueMonthsToGenerate(triggersNewQuarter, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-01-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('anual: só gera quando o mês de vencimento calculado é janeiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL' }
    const triggersNewYear = new Date(Date.UTC(2026, 11, 20))
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20))
    expect(computeDueMonthsToGenerate(triggersNewYear, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2027-01-01'])
    expect(computeDueMonthsToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('lança erro se chamada com periodicidade WEEKLY', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    expect(() => computeDueMonthsToGenerate(new Date(Date.UTC(2026, 0, 20)), rules)).toThrow()
  })

  it('regressão do bug original: DAS com generationDayOfPeriod=20, generationMonthOffset=1, dueDayOfPeriod=10, competenceMonthOffset=1 — dispara 20/set, vence 10/out, competência setembro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 10, generationDayOfPeriod: 20, generationMonthOffset: 1, competenceMonthOffset: 1 }
    const trigger = new Date(Date.UTC(2026, 8, 20))
    const [dueMonth] = computeDueMonthsToGenerate(trigger, rules)
    expect(dueMonth.toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(computeDueDateFromMonth(dueMonth, rules).toISOString().slice(0, 10)).toBe('2026-10-10')
    expect(computeCompetenceFromDueMonth(dueMonth, rules).toISOString().slice(0, 10)).toBe('2026-09-01')
  })
})

describe('computeDueDate (só WEEKLY)', () => {
  it('semanal: competência é a segunda-feira da semana; dueDayOfPeriod=5 (sexta) cai na mesma semana', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 5 }
    const competence = new Date(Date.UTC(2026, 1, 2)) // segunda-feira
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-06')
  })
})

describe('computeCompetencesToGenerate (só WEEKLY)', () => {
  it('gera uma competência por cada dueDayOfPeriod que cai no mês seguinte inteiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 1 }
    const trigger = new Date(Date.UTC(2026, 0, 20))
    const mondaysOfFebruary2026 = computeCompetencesToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10))
    expect(mondaysOfFebruary2026).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'])
  })

  it('lança erro se chamada com periodicidade não-WEEKLY', () => {
    expect(() => computeCompetencesToGenerate(new Date(Date.UTC(2026, 0, 20)), monthlyRules)).toThrow()
  })
})

describe('computeCurrentPeriodStart', () => {
  it('mensal: início do mês corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 17))
    expect(computeCurrentPeriodStart(today, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('semanal: segunda-feira da semana corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira
    expect(computeCurrentPeriodStart(today, 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('trimestral: início do trimestre corrente', () => {
    const today = new Date(Date.UTC(2026, 4, 10)) // maio -> Q2 começa em abril
    expect(computeCurrentPeriodStart(today, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-04-01')
  })

  it('anual: início do ano corrente', () => {
    const today = new Date(Date.UTC(2026, 7, 1))
    expect(computeCurrentPeriodStart(today, 'ANNUAL').toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})

describe('normalizeToPeriodStart', () => {
  it('mensal: canonicaliza um instante qualquer do mês pro dia 1 do mesmo mês', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 17, 13, 22, 0))
    expect(normalizeToPeriodStart(arbitrary, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('semanal: canonicaliza um instante qualquer da semana pra segunda-feira daquela semana', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 18, 23, 59, 0)) // sexta-feira
    expect(normalizeToPeriodStart(arbitrary, 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-09-14')
  })

  it('trimestral: canonicaliza um instante qualquer do trimestre pro início do trimestre', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 30, 5, 0, 0)) // setembro -> Q3 começa em julho
    expect(normalizeToPeriodStart(arbitrary, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('anual: canonicaliza um instante qualquer do ano pro dia 1º de janeiro', () => {
    const arbitrary = new Date(Date.UTC(2026, 8, 17, 13, 22, 0))
    expect(normalizeToPeriodStart(arbitrary, 'ANNUAL').toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})

describe('computeNextDueMonth', () => {
  it('mensal: mesmo cálculo que o cron faria se disparasse hoje (gatilho + generationMonthOffset)', () => {
    const today = new Date(Date.UTC(2026, 8, 15)) // qualquer dia de setembro, não precisa ser o dia de gatilho
    expect(computeNextDueMonth(today, monthlyRules).toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  it('semanal: usa computeCurrentPeriodStart (semana corrente), ignora generationMonthOffset', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY' }
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira
    expect(computeNextDueMonth(today, rules).toISOString().slice(0, 10)).toBe('2026-03-16')
  })
})
```

- [ ] **Step 6: Rodar os testes da task**

```bash
pnpm --filter api exec vitest run src/modules/recurring-templates/recurrence-dates.test.ts
pnpm --filter api exec tsc --noEmit
```

Esperado: todos os testes passam, typecheck limpo. **Esse typecheck vai acusar erro em `recurring-templates.service.ts`, `recurring-templates.routes.ts`, `recurring-tasks.cron.ts` e nos arquivos de teste que os usam** (porque eles ainda chamam as funções antigas com a assinatura antiga) — isso é esperado, essas tasks são corrigidas nas próximas. Confirme especificamente que `recurrence-dates.test.ts` passa e que não há erro de tipo DENTRO de `recurrence-dates.ts` nem `recurring-templates.schema.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/modules/recurring-templates/recurring-templates.schema.ts apps/api/src/modules/recurring-templates/recurrence-dates.ts apps/api/src/modules/recurring-templates/recurrence-dates.test.ts
git commit -m "feat(recurring-templates): vencimento como âncora no cálculo de datas

Substitui dueMonthOffset (ancorado numa competência abstrata) por
competenceMonthOffset (competência derivada do vencimento). Migration
remove a coluna antiga e adiciona a nova com default 1. recurrence-dates.ts
ganha computeDueDateFromMonth/computeCompetenceFromDueMonth/computeDueMonthsToGenerate/
computeNextDueMonth; WEEKLY mantém o modelo anterior sem mudança de semântica.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Camada de serviço — geração individual e em lote

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.test.ts`

**Interfaces:**
- Consumes (de Task 1): `computeDueDateFromMonth`, `computeCompetenceFromDueMonth`, `computeNextDueMonth`, `normalizeToPeriodStart`, `computeDueDate` (WEEKLY), `RecurrenceDateRules` com `competenceMonthOffset`.
- Produces: `generateTaskForAssignment(templateId, assignmentId, dueMonth: Date)`, `generateManually(templateId, assignmentId, organizationId, dueMonthOverride?: string)`, `generateBulkForTemplate(templateId, organizationId, dueMonthRaw: string, assignmentIds: string[]): Promise<BulkGenerationResult>`, `generateBulkForAllTemplates(organizationId, dueMonthRaw: string): Promise<BulkGenerationSummary[]>`, `listAssignments(templateId, organizationId, search?: string)`, `getFailedGenerations(organizationId): Promise<FailedGeneration[]>`. Tipos `BulkGenerationResult`, `BulkGenerationSummary`, `FailedGeneration` exportados — Task 3 (routes) e o frontend (via `types/index.ts` em Task 5) consomem essas formas.

- [ ] **Step 1: Atualizar imports**

No topo de `recurring-templates.service.ts`, trocar:

```ts
import {
  computeDueDate,
  computeTargetDate,
  computeCurrentPeriodStart,
  normalizeToPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'
```

por:

```ts
import {
  computeDueDate,
  computeDueDateFromMonth,
  computeCompetenceFromDueMonth,
  computeTargetDate,
  computeNextDueMonth,
  normalizeToPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'
```

(`computeCurrentPeriodStart` sai da lista — não é mais usada diretamente aqui, `computeNextDueMonth` cobre o caso).

- [ ] **Step 2: Reescrever `generateTaskForAssignment`**

Trocar a assinatura e o início da função (até a declaração de `logKey`):

```ts
export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  competence: Date,
): Promise<GenerationOutcome> {
  const template = await prisma.recurringTaskTemplate.findUnique({
    where: { id: templateId },
    include: { documentRequests: true, documentDeliveries: true },
  })
  if (!template) return { status: 'FAILED', errorMessage: 'Template não encontrado' }

  const assignment = await prisma.recurringTaskAssignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.templateId !== templateId) {
    return { status: 'FAILED', errorMessage: 'Vínculo não encontrado' }
  }

  const logKey = {
    templateId_clientId_competence: { templateId, clientId: assignment.clientId, competence },
  }
```

por:

```ts
export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  dueMonth: Date,
): Promise<GenerationOutcome> {
  const template = await prisma.recurringTaskTemplate.findUnique({
    where: { id: templateId },
    include: { documentRequests: true, documentDeliveries: true },
  })
  if (!template) return { status: 'FAILED', errorMessage: 'Template não encontrado' }

  const assignment = await prisma.recurringTaskAssignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.templateId !== templateId) {
    return { status: 'FAILED', errorMessage: 'Vínculo não encontrado' }
  }

  const rules: RecurrenceDateRules = template
  // WEEKLY: dueMonth É a competência (contrato herdado, sem mudança de semântica — ver Task 1).
  // Demais periodicidades: dueMonth é o 1º dia do mês de vencimento; competência é derivada
  // dele (vencimento é a âncora, não mais o contrário).
  const competence = rules.periodicity === 'WEEKLY' ? dueMonth : computeCompetenceFromDueMonth(dueMonth, rules)

  const logKey = {
    templateId_clientId_competence: { templateId, clientId: assignment.clientId, competence },
  }
```

Mais abaixo, dentro do bloco `try`, trocar:

```ts
    const systemBoard = await ensureRecurringSystemBoard(assignment.clientId, template.organizationId)
    const columnId = systemBoard.columns[0].id

    const rules: RecurrenceDateRules = template
    const dueDate = computeDueDate(competence, rules)
    const targetDate = computeTargetDate(dueDate, rules)
```

por:

```ts
    const systemBoard = await ensureRecurringSystemBoard(assignment.clientId, template.organizationId)
    const columnId = systemBoard.columns[0].id

    const dueDate = rules.periodicity === 'WEEKLY' ? computeDueDate(dueMonth, rules) : computeDueDateFromMonth(dueMonth, rules)
    const targetDate = computeTargetDate(dueDate, rules)
```

(removida a redeclaração de `const rules` que já existe mais acima agora — resto do corpo da função, do `const initialStatus` em diante, fica idêntico ao atual, sem mudança nenhuma).

- [ ] **Step 3: Reescrever `generateManually`**

Trocar a função inteira:

```ts
export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  competenceOverride?: string,
) {
  const template = await getTemplateById(templateId, organizationId)
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  // Canonicaliza o override pro início do período (semana/mês/trimestre/ano) a que ele
  // pertence — sem isso, um instante não-canônico (ex.: 2026-09-17T13:22:00Z) viraria uma
  // chave de idempotência que nunca colide com o valor canônico que o cron gera pro mesmo
  // período real, criando uma Task efetivamente duplicada sem o sistema de idempotência notar.
  const competence = competenceOverride
    ? normalizeToPeriodStart(new Date(competenceOverride), template.periodicity)
    : computeCurrentPeriodStart(new Date(), template.periodicity)

  const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

  if (outcome.status === 'ALREADY_EXISTS') {
    throw new AppError(409, 'Já existe tarefa gerada pra essa competência e esse cliente')
  }
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao gerar: ${outcome.errorMessage}`)
  }
  return { taskId: outcome.taskId }
}
```

por:

```ts
export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  dueMonthOverride?: string,
) {
  const template = await getTemplateById(templateId, organizationId)
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  const rules: RecurrenceDateRules = template
  // Canonicaliza o override pro início do período a que ele pertence — mesmo raciocínio de
  // idempotência de antes (ver comentário original). Sem override: usa o próximo ciclo normal
  // do template (o que o cron geraria no próximo disparo), não mais "o mês/semana atual cru".
  const dueMonth = dueMonthOverride
    ? normalizeToPeriodStart(new Date(dueMonthOverride), template.periodicity)
    : computeNextDueMonth(new Date(), rules)

  const outcome = await generateTaskForAssignment(template.id, assignment.id, dueMonth)

  if (outcome.status === 'ALREADY_EXISTS') {
    throw new AppError(409, 'Já existe tarefa gerada pra essa competência e esse cliente')
  }
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao gerar: ${outcome.errorMessage}`)
  }
  return { taskId: outcome.taskId }
}
```

- [ ] **Step 4: Adicionar `listAssignments` com busca**

Trocar:

```ts
export async function listAssignments(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringTaskAssignment.findMany({
    where: { templateId },
    include: { client: { select: { id: true, name: true, codigo: true } } },
    orderBy: { createdAt: 'asc' },
  })
}
```

por:

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

- [ ] **Step 5: Adicionar `generateBulkForTemplate`, `generateBulkForAllTemplates` e `getFailedGenerations`**

No final do arquivo (depois de `listGenerationLog`), adicionar:

```ts
export interface BulkGenerationResult {
  generated: number
  alreadyExists: number
  failed: { clientName: string; errorMessage: string }[]
}

export async function generateBulkForTemplate(
  templateId: string,
  organizationId: string,
  dueMonthRaw: string,
  assignmentIds: string[],
): Promise<BulkGenerationResult> {
  const template = await getTemplateById(templateId, organizationId)
  const dueMonth = normalizeToPeriodStart(new Date(dueMonthRaw), template.periodicity)

  const assignments = await prisma.recurringTaskAssignment.findMany({
    where: { id: { in: assignmentIds }, templateId },
    include: { client: { select: { name: true } } },
  })
  const foundIds = new Set(assignments.map((a) => a.id))

  const result: BulkGenerationResult = { generated: 0, alreadyExists: 0, failed: [] }

  // IDs que não pertencem a este template/org (removidos entre a seleção na tela e o clique
  // no botão, ou um request forjado) entram em failed[] com motivo explícito — nunca somem
  // silenciosamente, ver spec "Falhas persistentes".
  for (const requestedId of assignmentIds) {
    if (!foundIds.has(requestedId)) {
      result.failed.push({ clientName: '(cliente não encontrado)', errorMessage: 'Cliente não encontrado ou não vinculado a este template' })
    }
  }

  for (const assignment of assignments) {
    const outcome = await generateTaskForAssignment(templateId, assignment.id, dueMonth)
    if (outcome.status === 'SUCCESS') result.generated++
    else if (outcome.status === 'ALREADY_EXISTS') result.alreadyExists++
    else result.failed.push({ clientName: assignment.client.name, errorMessage: outcome.errorMessage })
  }

  return result
}

export interface BulkGenerationSummary {
  templateId: string
  templateTitle: string
  result: BulkGenerationResult
}

export async function generateBulkForAllTemplates(
  organizationId: string,
  dueMonthRaw: string,
): Promise<BulkGenerationSummary[]> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { organizationId, isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  const summaries: BulkGenerationSummary[] = []
  for (const template of templates) {
    const assignmentIds = template.assignments.map((a) => a.id)
    const result = assignmentIds.length > 0
      ? await generateBulkForTemplate(template.id, organizationId, dueMonthRaw, assignmentIds)
      : { generated: 0, alreadyExists: 0, failed: [] }
    summaries.push({ templateId: template.id, templateTitle: template.title, result })
  }
  return summaries
}

export interface FailedGeneration {
  templateId: string
  templateTitle: string
  clientId: string
  clientName: string
  competence: string
  errorMessage: string
  createdAt: string
}

export async function getFailedGenerations(organizationId: string): Promise<FailedGeneration[]> {
  const logs = await prisma.recurringGenerationLog.findMany({
    where: { status: 'FAILED', template: { organizationId } },
    include: { template: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (logs.length === 0) return []

  const clientIds = [...new Set(logs.map((l) => l.clientId))]
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]))

  return logs.map((log) => ({
    templateId: log.template.id,
    templateTitle: log.template.title,
    clientId: log.clientId,
    clientName: clientNameById.get(log.clientId) ?? '(cliente removido)',
    competence: log.competence.toISOString(),
    errorMessage: log.errorMessage ?? '',
    createdAt: log.createdAt.toISOString(),
  }))
}
```

- [ ] **Step 6: Atualizar fixtures em `recurring-templates.service.test.ts`**

O arquivo tem 11 ocorrências do padrão `periodicity: 'MONTHLY', priority: 'MEDIUM',` (ou `'WEEKLY'`) seguidas de `dueMonthOffset: <N>,`. Trocar cada `dueMonthOffset: <N>,` por `competenceMonthOffset: <N>,` (mantém o mesmo número — os valores existentes de `dueMonthOffset` nessas fixtures de teste, que eram usados como offset-de-competência-pra-vencimento, continuam fazendo sentido numérico como offset-de-vencimento-pra-competência, já que os testes não dependem do valor específico pra nada além de "tem um offset configurado").

Além disso, todo teste que chama `generateTaskForAssignment(template.id, assignment.id, <alguma data>)` diretamente passando uma competência calculada à mão — buscar por `generateTaskForAssignment(` no arquivo e, pra cada chamada, confirmar se a data passada deveria continuar representando uma competência (se o teste é de template `WEEKLY`) ou precisa virar um "mês de vencimento" (se o teste é `MONTHLY`/`QUARTERLY`/`ANNUAL` — trocar a data passada pelo mês de vencimento equivalente, e ajustar os `expect` de `task.dueDate`/`task.competence` de acordo com as novas funções `computeDueDateFromMonth`/`computeCompetenceFromDueMonth`). Fazer essa checagem individualmente por teste — não é um replace mecânico, é a mesma mudança de semântica da Task 1/2 aplicada a cada asserção específica.

Adicionar um teste novo no `describe('generateTaskForAssignment', ...)` existente, logo depois do teste "gera a tarefa com a prioridade configurada no template":

```ts
  it('DAS: dueMonth=outubro, dueDayOfPeriod=10, competenceMonthOffset=1 → vence 10/outubro, competência setembro', async () => {
    const { assignment } = await setup()
    const template = await createTemplate((await setup()).org.id, {
      departmentId: (await setup()).dept.id, title: 'DAS', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const dasAssignment = await createAssignment(template.id, (await setup()).org.id, { clientId: (await setup()).client.id })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)) // outubro
    const outcome = await generateTaskForAssignment(template.id, dasAssignment.id, dueMonth)
    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-10')
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2026-09-01')
  })
```

(Nota pro implementador: a chamada repetida a `setup()` acima é só pra ilustrar os campos necessários — como `setup()` já existe no arquivo criando org/dept/client/template/assignment próprios a cada chamada, reescreva esse teste chamando `setup()` **uma única vez** no início, igual aos outros testes do mesmo `describe`, e use os valores retornados — não chame `setup()` múltiplas vezes dentro do mesmo teste.)

- [ ] **Step 7: Testes novos pra `generateBulkForTemplate`/`generateBulkForAllTemplates`**

Criar um novo `describe` no final de `recurring-templates.service.test.ts`:

```ts
describe('generateBulkForTemplate', () => {
  it('gera parcial: sucesso + já existe + falha de ID inválido no mesmo lote, sem derrubar os outros', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Lote', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignmentA = await createAssignment(template.id, org.id, { clientId: clientA.id })
    const assignmentB = await createAssignment(template.id, org.id, { clientId: clientB.id })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()

    // Gera uma vez só pra clientB, pra forçar ALREADY_EXISTS no lote
    await generateTaskForAssignment(template.id, assignmentB.id, new Date(Date.UTC(2026, 9, 1)))

    const result = await generateBulkForTemplate(template.id, org.id, dueMonth, [
      assignmentA.id,
      assignmentB.id,
      'cmxxxxxxxxxxxxxxxxxxxxxxx0', // id válido no formato cuid mas inexistente
    ])

    expect(result.generated).toBe(1)
    expect(result.alreadyExists).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].errorMessage).toContain('não encontrado')

    vi.restoreAllMocks()
  })
})

describe('generateBulkForAllTemplates', () => {
  it('roda todos os templates ativos da org, inclusive os sem vínculo (0 geradas)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const withAssignment = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Com vínculo', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(withAssignment.id, org.id, { clientId: client.id })

    await createTemplate(org.id, {
      departmentId: dept.id, title: 'Sem vínculo', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    const dueMonth = new Date(Date.UTC(2026, 9, 1)).toISOString()
    const summaries = await generateBulkForAllTemplates(org.id, dueMonth)

    expect(summaries).toHaveLength(2)
    const withAssignmentSummary = summaries.find((s) => s.templateTitle === 'Com vínculo')
    const withoutAssignmentSummary = summaries.find((s) => s.templateTitle === 'Sem vínculo')
    expect(withAssignmentSummary?.result.generated).toBe(1)
    expect(withoutAssignmentSummary?.result.generated).toBe(0)

    vi.restoreAllMocks()
  })
})

describe('getFailedGenerations', () => {
  it('retorna falhas com nome do cliente, e trata clientId órfão sem quebrar', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Falhável', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: client.id,
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro de teste',
      },
    })
    // clientId que não existe mais (simula cliente excluído depois da falha)
    await prisma.recurringGenerationLog.create({
      data: {
        templateId: template.id, clientId: 'cmxxxxxxxxxxxxxxxxxxxxxxx1',
        competence: new Date(Date.UTC(2026, 8, 1)),
        status: 'FAILED', errorMessage: 'Erro órfão',
      },
    })

    const failures = await getFailedGenerations(org.id)
    expect(failures).toHaveLength(2)
    const withClient = failures.find((f) => f.clientId === client.id)
    const orphan = failures.find((f) => f.clientId === 'cmxxxxxxxxxxxxxxxxxxxxxxx1')
    expect(withClient?.clientName).toBe(client.name)
    expect(orphan?.clientName).toBe('(cliente removido)')

    vi.restoreAllMocks()
  })
})
```

Adicionar `generateBulkForTemplate`, `generateBulkForAllTemplates`, `getFailedGenerations` aos imports do topo do arquivo de teste.

- [ ] **Step 8: Rodar os testes da task**

```bash
pnpm --filter api exec vitest run src/modules/recurring-templates/recurring-templates.service.test.ts
pnpm --filter api exec tsc --noEmit
```

Typecheck ainda vai acusar erro em `recurring-templates.routes.ts`/`recurring-tasks.cron.ts` (tasks seguintes) — confirme que não há erro dentro de `recurring-templates.service.ts` nem no arquivo de teste dele.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/recurring-templates/recurring-templates.service.ts apps/api/src/modules/recurring-templates/recurring-templates.service.test.ts
git commit -m "feat(recurring-templates): geração em lote (por template e global) + log de falhas consultável

generateTaskForAssignment/generateManually passam a receber dueMonth
em vez de competence, derivando a competência internamente. Duas
funções novas processam lote item a item sem derrubar o restante por
uma falha (ID inválido entra em failed[] com motivo explícito, nunca
é ignorado). getFailedGenerations alimenta a visibilidade persistente
de falhas que as telas novas vão consumir.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Endpoints — lote, falhas e geração individual renomeada

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.routes.ts`
- Modify: `apps/api/src/modules/task-documents/task-documents.service.test.ts`
- Modify: `apps/api/src/modules/tasks/tasks.routes.test.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.routes.test.ts`

**Interfaces:**
- Consumes (de Task 2): `generateBulkForTemplate`, `generateBulkForAllTemplates`, `getFailedGenerations`, `listAssignments(templateId, organizationId, search?)`, `generateManually(..., dueMonthOverride?)`.
- Consumes (de Task 1): `bulkGenerateSchema`, `bulkGenerateAllSchema`, `manualGenerateSchema` (já com `dueMonth`).
- Produces: rotas HTTP documentadas na spec, seção "Endpoints novos/alterados" — Task 6/7 (frontend) consomem essas rotas.

- [ ] **Step 1: Atualizar imports em `recurring-templates.routes.ts`**

Trocar:

```ts
import {
  createTemplateSchema,
  updateTemplateSchema,
  createAssignmentSchema,
  updateAssignmentSchema,
  manualGenerateSchema,
} from './recurring-templates.schema'
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  generateManually,
  listGenerationLog,
} from './recurring-templates.service'
```

por:

```ts
import {
  createTemplateSchema,
  updateTemplateSchema,
  createAssignmentSchema,
  updateAssignmentSchema,
  manualGenerateSchema,
  bulkGenerateSchema,
  bulkGenerateAllSchema,
} from './recurring-templates.schema'
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  generateManually,
  listGenerationLog,
  generateBulkForTemplate,
  generateBulkForAllTemplates,
  getFailedGenerations,
} from './recurring-templates.service'
```

- [ ] **Step 2: Adicionar `GET /failed-generations` ANTES de `GET /:id`**

**Ordem importa** (ver Review Focus) — inserir logo após `app.addHook('preHandler', verifyJWT)` e antes do `app.get('/:id', ...)` existente:

```ts
  app.get('/failed-generations', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    return reply.send(await getFailedGenerations(request.user.organizationId!))
  })
```

- [ ] **Step 3: `?q=` em `GET /:id/assignments`**

Trocar:

```ts
  app.get('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listAssignments(id, request.user.organizationId!))
  })
```

por:

```ts
  app.get('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { q } = request.query as { q?: string }
    return reply.send(await listAssignments(id, request.user.organizationId!, q))
  })
```

- [ ] **Step 4: Atualizar o body de `POST /:id/assignments/:assignmentId/generate`**

Trocar:

```ts
    return reply.status(201).send(
      await generateManually(id, assignmentId, request.user.organizationId!, result.data.competence),
    )
```

por:

```ts
    return reply.status(201).send(
      await generateManually(id, assignmentId, request.user.organizationId!, result.data.dueMonth),
    )
```

- [ ] **Step 5: Adicionar `POST /:id/assignments/bulk-generate` e `POST /bulk-generate`**

Logo depois da rota `generate` existente, adicionar:

```ts
  app.post('/:id/assignments/bulk-generate', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = bulkGenerateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await generateBulkForTemplate(id, request.user.organizationId!, result.data.dueMonth, result.data.assignmentIds),
    )
  })

  app.post('/bulk-generate', { preHandler: [...adminOnly, checkSubscription] }, async (request, reply) => {
    const result = bulkGenerateAllSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await generateBulkForAllTemplates(request.user.organizationId!, result.data.dueMonth))
  })
```

**Atenção de ordem**: `POST /bulk-generate` (sem `:id`) precisa ficar registrada ANTES de qualquer rota `POST /:id/...` nesse arquivo pra não ter risco de colisão de matching — adicionar logo depois do bloco acima, antes de qualquer outro `POST` que use `:id`. Conferir a ordem final do arquivo depois de editar.

- [ ] **Step 6: Atualizar fixtures em `task-documents.service.test.ts` e `tasks.routes.test.ts`**

Cada um desses arquivos tem **uma** ocorrência de `periodicity: 'MONTHLY', ... dueMonthOffset: 0,` (fixture inline, formato de uma linha) usada só pra criar um template de apoio — não testam cálculo de data diretamente. Trocar `dueMonthOffset: 0,` por `competenceMonthOffset: 1,` em cada um (valor 1 porque é o default/mais realista, e esses testes não dependem do valor específico).

- [ ] **Step 7: Teste novo em `recurring-templates.routes.test.ts`**

Adicionar ao final do arquivo:

```ts
describe('GET /recurring-templates/failed-generations — rota estática não colide com /:id', () => {
  it('retorna 200 (não cai no handler de /:id)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const header = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'GET',
      url: '/recurring-templates/failed-generations',
      headers: { authorization: header },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })
})
```

- [ ] **Step 8: Rodar os testes da task**

```bash
pnpm --filter api exec vitest run src/modules/recurring-templates src/modules/task-documents/task-documents.service.test.ts src/modules/tasks/tasks.routes.test.ts
pnpm --filter api exec tsc --noEmit
```

Typecheck ainda vai acusar erro em `recurring-tasks.cron.ts` (Task 4) — confirme que não há erro em nenhum arquivo desta task.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/recurring-templates/recurring-templates.routes.ts apps/api/src/modules/recurring-templates/recurring-templates.routes.test.ts apps/api/src/modules/task-documents/task-documents.service.test.ts apps/api/src/modules/tasks/tasks.routes.test.ts
git commit -m "feat(recurring-templates): endpoints de geração em lote e falhas pendentes

POST .../bulk-generate (por template) e POST /bulk-generate (todos os
templates ativos), GET /failed-generations (registrada antes de /:id
pra não colidir), busca por nome em GET .../assignments.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Cron — usar o mês de vencimento

**Files:**
- Modify: `apps/api/src/workers/recurring-tasks.cron.ts`
- Modify: `apps/api/src/workers/recurring-tasks.cron.test.ts`

**Interfaces:**
- Consumes (de Task 1): `computeDueMonthsToGenerate`, `computeCompetencesToGenerate` (agora WEEKLY-only).
- Consumes (de Task 2): `generateTaskForAssignment(templateId, assignmentId, dueMonth)`.
- Produces: nenhuma interface nova — só corrige o caller do motor de recorrência.

- [ ] **Step 1: Atualizar `recurring-tasks.cron.ts`**

Trocar o conteúdo de `runRecurringTasksGeneration`:

```ts
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function runRecurringTasksGeneration(today: Date = new Date()): Promise<void> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  for (const template of templates) {
    let competences: Date[]
    try {
      const rules: RecurrenceDateRules = template
      competences = computeCompetencesToGenerate(today, rules)
    } catch {
      continue
    }
    if (competences.length === 0) continue

    for (const assignment of template.assignments) {
      for (const competence of competences) {
        try {
          await generateTaskForAssignment(template.id, assignment.id, competence)
        } catch {
        }
      }
    }
  }
}
```

por:

```ts
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, computeDueMonthsToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function runRecurringTasksGeneration(today: Date = new Date()): Promise<void> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  for (const template of templates) {
    let dueMonths: Date[]
    try {
      const rules: RecurrenceDateRules = template
      // WEEKLY continua ancorado em competência (a própria semana); as demais periodicidades
      // agora calculam direto o mês de vencimento — ver spec 2026-10-06.
      dueMonths = rules.periodicity === 'WEEKLY'
        ? computeCompetencesToGenerate(today, rules)
        : computeDueMonthsToGenerate(today, rules)
    } catch {
      // Falha no cálculo não deve derrubar o cron inteiro — pula esse template nesta
      // execução, o próximo dia tenta de novo.
      continue
    }
    if (dueMonths.length === 0) continue

    for (const assignment of template.assignments) {
      for (const dueMonth of dueMonths) {
        try {
          await generateTaskForAssignment(template.id, assignment.id, dueMonth)
        } catch {
          // generateTaskForAssignment já captura e loga qualquer erro esperado (retorna
          // FAILED, nunca deveria lançar) — defesa extra contra bug inesperado.
        }
      }
    }
  }
}

export async function startRecurringTasksCronWorker() {
  const cronQueue = new Queue('recurring-tasks-cron', { connection: bullmqRedis })

  await cronQueue.add('generate', {}, {
    repeat: { every: 3_600_000 * 24 },
    jobId: 'recurring-tasks-generate',
  })

  return new Worker('recurring-tasks-cron', async () => {
    await runRecurringTasksGeneration()
  }, { connection: bullmqRedis })
}
```

(só a função `runRecurringTasksGeneration` muda — `startRecurringTasksCronWorker` fica idêntica, reproduzida acima só pra deixar claro o arquivo completo).

- [ ] **Step 2: Atualizar fixtures em `recurring-tasks.cron.test.ts`**

O arquivo tem 3 ocorrências de `periodicity: 'MONTHLY', priority: 'MEDIUM', dueMonthOffset: 0,` (formato inline, uma linha). Trocar cada `dueMonthOffset: 0,` por `competenceMonthOffset: 1,`.

- [ ] **Step 3: Teste novo — confirma que o cron usa `computeDueMonthsToGenerate` pra MONTHLY**

Adicionar ao `describe('runRecurringTasksGeneration', ...)` existente:

```ts
  it('tarefa gerada pelo cron nunca nasce com vencimento no passado (regressão do bug original)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'DAS', periodicity: 'MONTHLY', priority: 'MEDIUM',
      dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
      targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
      competenceMonthOffset: 1,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id })

    const trigger = new Date(Date.UTC(2026, 8, 20)) // 20 de setembro
    await runRecurringTasksGeneration(trigger)

    const task = await prisma.task.findFirstOrThrow({ where: { recurringTemplateId: template.id } })
    expect(task.dueDate!.getTime()).toBeGreaterThan(trigger.getTime())
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-10')
    expect(task.competence?.toISOString().slice(0, 10)).toBe('2026-09-01')

    vi.restoreAllMocks()
  })
```

- [ ] **Step 4: Rodar os testes da task**

```bash
pnpm --filter api exec vitest run src/workers/recurring-tasks.cron.test.ts
pnpm --filter api exec tsc --noEmit
```

Typecheck deve estar **limpo agora** (todas as tasks de backend concluídas). Rodar a suíte completa da API pra confirmar que nada mais quebrou:

```bash
pnpm --filter api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/recurring-tasks.cron.ts apps/api/src/workers/recurring-tasks.cron.test.ts
git commit -m "fix(recurring-templates): cron usa mês de vencimento em vez de competência

Completa a migração pro modelo vencimento-como-âncora no caminho
automático (cron) — o mesmo bug que motivou esta spec (tarefa gerada
já vencida) não pode mais acontecer, com teste de regressão explícito.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — tipos e formulário do template

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/app/settings/RecurringTemplateForm.tsx`

**Interfaces:**
- Consumes (de Task 1/3): campo `competenceMonthOffset` no lugar de `dueMonthOffset`, campo `dueMonth` no lugar de `competence` nos bodies de geração.
- Produces: `RecurringTaskTemplate['competenceMonthOffset']`, tipos `BulkGenerationResult`, `BulkGenerationSummary`, `FailedGeneration` em `types/index.ts` — Task 6/7/8 (as três telas novas) consomem esses tipos.

- [ ] **Step 1: Atualizar `RecurringTaskTemplate` em `types/index.ts`**

Em `apps/web/src/types/index.ts` (linha ~151), trocar:

```ts
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueMonthOffset: number
  dueDayOfPeriod: number
```

por:

```ts
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDayOfPeriod: number
```

e, logo depois do campo `dueBusinessDayRoll` no mesmo interface, adicionar `competenceMonthOffset: number`:

```ts
  dueBusinessDayRoll: 'NONE' | 'FORWARD' | 'BACKWARD'
  competenceMonthOffset: number
  targetOffsetDays: number
```

- [ ] **Step 2: Adicionar tipos novos de geração em lote**

Logo depois da interface `RecurringGenerationLog` em `types/index.ts`, adicionar:

```ts
export interface BulkGenerationResult {
  generated: number
  alreadyExists: number
  failed: { clientName: string; errorMessage: string }[]
}

export interface BulkGenerationSummary {
  templateId: string
  templateTitle: string
  result: BulkGenerationResult
}

export interface FailedGeneration {
  templateId: string
  templateTitle: string
  clientId: string
  clientName: string
  competence: string
  errorMessage: string
  createdAt: string
}
```

- [ ] **Step 3: Trocar o campo no form — `RecurringTemplateForm.tsx`**

Remover as constantes não usadas mais (`DUE_MONTH_OFFSET_OPTIONS`, a função `dueMonthOffsetLabel`) e trocar `GENERATION_MONTH_OFFSET_OPTIONS` por uma lista maior (já que agora é o único controle de antecedência que resta, faz sentido permitir mais opções — mas manter 0-3 como já era, sem mudar o range, só reaproveitar).

Trocar:

```ts
const DUE_MONTH_OFFSET_OPTIONS = Array.from({ length: 25 }, (_, i) => i - 12) // -12..12
const GENERATION_MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
```

por:

```ts
const GENERATION_MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
const COMPETENCE_MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
```

Remover a função `dueMonthOffsetLabel` inteira (linhas 30-34).

No `interface FormState`, trocar:

```ts
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueBusinessDayRoll: RecurringTaskTemplate['dueBusinessDayRoll']
```

por:

```ts
  dueDayOfPeriod: number
  dueBusinessDayRoll: RecurringTaskTemplate['dueBusinessDayRoll']
  competenceMonthOffset: number
```

No `EMPTY_FORM`, trocar:

```ts
  dueMonthOffset: 0, dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE',
```

por:

```ts
  dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE', competenceMonthOffset: 1,
```

No `useEffect` que sincroniza `form` com `template` carregado, trocar:

```ts
      periodicity: template.periodicity, priority: template.priority, dueMonthOffset: template.dueMonthOffset, dueDayOfPeriod: template.dueDayOfPeriod,
      dueBusinessDayRoll: template.dueBusinessDayRoll, targetOffsetDays: template.targetOffsetDays,
```

por:

```ts
      periodicity: template.periodicity, priority: template.priority, dueDayOfPeriod: template.dueDayOfPeriod,
      dueBusinessDayRoll: template.dueBusinessDayRoll, competenceMonthOffset: template.competenceMonthOffset, targetOffsetDays: template.targetOffsetDays,
```

No JSX, trocar o bloco do seletor "Competência do vencimento" (dentro do `<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">` que também tem o seletor de dia do vencimento):

```tsx
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Competência do vencimento</Label>
            <select
              value={form.dueMonthOffset}
              onChange={(e) => setForm({ ...form, dueMonthOffset: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
              disabled={isWeekly}
            >
              {DUE_MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o} — {dueMonthOffsetLabel(o)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{isWeekly ? 'Dia da semana do vencimento' : 'Dia do vencimento'}</Label>
```

por:

```tsx
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{isWeekly ? 'Dia da semana do vencimento' : 'Dia do vencimento'}</Label>
```

(remove o seletor antigo inteiro — o `<select>` de dia do vencimento que estava na segunda coluna do grid passa a ser o único item, então vira a primeira e única coluna; ajustar o fechamento das tags JSX de acordo, removendo a `</div>` extra que sobrar da coluna removida).

Logo depois do bloco "Se o vencimento cair em fim de semana" (antes do bloco "Meta interna"), adicionar um novo campo:

```tsx
        <div className="space-y-1.5">
          <Label>Competência — meses antes do vencimento</Label>
          <select
            value={form.competenceMonthOffset}
            onChange={(e) => setForm({ ...form, competenceMonthOffset: Number(e.target.value) })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            disabled={isWeekly}
          >
            {COMPETENCE_MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês do vencimento' : `${o} ${o === 1 ? 'mês' : 'meses'} antes do vencimento`}</option>)}
          </select>
        </div>
```

No bloco "Geração — meses antes da competência" (mais abaixo), trocar só o `<Label>` (o `value`/`onChange` continuam usando `generationMonthOffset`, sem mudança de campo, só de rótulo porque a âncora mudou):

```tsx
            <Label>Geração — meses antes da competência</Label>
```

por:

```tsx
            <Label>Geração — meses antes do vencimento</Label>
```

e, logo abaixo do `</select>` desse mesmo campo, adicionar o aviso de risco quando `generationMonthOffset=0`:

```tsx
            {form.generationMonthOffset === 0 && (
              <p className="text-xs text-danger-text mt-1">
                ⚠ Com 0 mês de antecedência, a tarefa é gerada no mesmo mês do vencimento — se o dia do vencimento já tiver passado quando o cron disparar, ela nasce vencida.
              </p>
            )}
```

- [ ] **Step 4: Typecheck e smoke test visual**

```bash
pnpm --filter web exec tsc --noEmit
```

Com os dev servers rodando (`pnpm --filter api dev` e `pnpm --filter web dev`, mesmo padrão já usado nesta sessão), abrir `/app/settings/recurring-templates/new` via Playwright e confirmar visualmente: campo "Competência — meses antes do vencimento" aparece, campo antigo "Competência do vencimento" não existe mais, selecionar `generationMonthOffset=0` mostra o aviso vermelho.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/pages/app/settings/RecurringTemplateForm.tsx
git commit -m "feat(recurring-templates): form reflete vencimento como âncora

Campo 'Competência do vencimento' (dueMonthOffset) sai; entra
'Competência — meses antes do vencimento' (competenceMonthOffset).
Aviso visual quando antecedência de geração = 0 (risco de gerar já
vencido).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend — página de gestão do template (substitui o popup)

**Files:**
- Create: `apps/web/src/pages/app/settings/RecurringTemplateManage.tsx`
- Modify: `apps/web/src/pages/app/settings/RecurringTemplates.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes (de Task 3): `GET /recurring-templates/:id/assignments?q=`, `POST /recurring-templates/:id/assignments/bulk-generate`, `GET /recurring-templates/failed-generations`, mais os endpoints de vincular/desvincular/log que já existiam.
- Consumes (de Task 5): `BulkGenerationResult`, `FailedGeneration` de `@/types`.
- Produces: rota `/app/settings/recurring-templates/:id/manage` — Task 8 (hub) não depende diretamente dela, mas o link "Vínculos e log" da listagem passa a apontar pra cá.

- [ ] **Step 1: Criar `RecurringTemplateManage.tsx`**

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2, History, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type {
  RecurringTaskTemplate,
  RecurringTaskAssignment,
  RecurringGenerationLog,
  Client,
  BulkGenerationResult,
  FailedGeneration,
} from '@/types'

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthValueToISO(monthValue: string): string {
  return new Date(`${monthValue}-01T00:00:00.000Z`).toISOString()
}

export default function RecurringTemplateManage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [dueMonth, setDueMonth] = useState(currentMonthValue())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clientId, setClientId] = useState('')

  const { data: template, isLoading: loadingTemplate } = useQuery<RecurringTaskTemplate>({
    queryKey: ['recurring-template', id],
    queryFn: () => api.get(`/recurring-templates/${id}`).then((r) => r.data),
  })

  const { data: assignments = [] } = useQuery<RecurringTaskAssignment[]>({
    queryKey: ['recurring-assignments', id, search],
    queryFn: () => api.get(`/recurring-templates/${id}/assignments`, { params: search ? { q: search } : {} }).then((r) => r.data),
    enabled: !!id,
  })

  const { data: logs = [] } = useQuery<RecurringGenerationLog[]>({
    queryKey: ['recurring-generation-log', id],
    queryFn: () => api.get(`/recurring-templates/${id}/generation-log`).then((r) => r.data),
    enabled: !!id,
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: allFailures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
  })
  const templateFailures = allFailures.filter((f) => f.templateId === id)

  const addMutation = useMutation({
    mutationFn: () => api.post(`/recurring-templates/${id}/assignments`, { clientId }),
    onSuccess: () => {
      toast.success('Cliente vinculado')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', id] })
      setClientId('')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao vincular cliente')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/recurring-templates/${id}/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success('Vínculo removido')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', id] })
      setSelected((prev) => {
        const next = new Set(prev)
        return next
      })
    },
  })

  const bulkGenerateMutation = useMutation({
    mutationFn: () =>
      api.post<BulkGenerationResult>(`/recurring-templates/${id}/assignments/bulk-generate`, {
        dueMonth: monthValueToISO(dueMonth),
        assignmentIds: [...selected],
      }).then((r) => r.data),
    onSuccess: (result) => {
      toast.success(`${result.generated} geradas, ${result.alreadyExists} já existiam, ${result.failed.length} falharam`)
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', id] })
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
      setSelected(new Set())
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar em lote')
    },
  })

  const retryMutation = useMutation({
    mutationFn: (failure: FailedGeneration) =>
      api.post(`/recurring-templates/${failure.templateId}/assignments/bulk-generate`, {
        dueMonth: failure.competence,
        assignmentIds: assignments.filter((a) => a.clientId === failure.clientId).map((a) => a.id),
      }),
    onSuccess: () => {
      toast.success('Tentativa de nova geração enviada')
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', id] })
    },
  })

  function toggleSelected(assignmentId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(assignmentId)) next.delete(assignmentId)
      else next.add(assignmentId)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(assignments.map((a) => a.id)))
  }

  if (loadingTemplate || !template) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/settings/recurring-templates" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">{template.title} — vínculos e geração</h1>
      </div>

      {templateFailures.length > 0 && (
        <Card className="border-danger-text bg-danger-bg px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-danger-text font-medium text-sm">
            <AlertTriangle size={16} />
            {templateFailures.length} {templateFailures.length === 1 ? 'tarefa não foi gerada' : 'tarefas não foram geradas'}
          </div>
          <ul className="space-y-1">
            {templateFailures.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-danger-text">
                <span>{f.clientName} — competência {new Date(f.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {f.errorMessage}</span>
                <button
                  type="button"
                  onClick={() => retryMutation.mutate(f)}
                  disabled={retryMutation.isPending}
                  className="underline hover:no-underline flex-shrink-0 ml-2"
                >
                  Gerar novamente
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="px-4 py-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="space-y-1.5">
            <Label>Mês de vencimento</Label>
            <input
              type="month"
              value={dueMonth}
              onChange={(e) => setDueMonth(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            />
          </div>
          <div className="space-y-1.5 flex-1">
            <Label>Buscar cliente</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do cliente..." />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="text-xs text-accent hover:underline">Selecionar todos</button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:underline">Limpar seleção</button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => bulkGenerateMutation.mutate()}
            disabled={selected.size === 0 || bulkGenerateMutation.isPending}
          >
            {bulkGenerateMutation.isPending ? 'Gerando...' : `Gerar selecionados (${selected.size})`}
          </Button>
        </div>

        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {assignments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
          ) : (
            assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelected(a.id)} />
                  {a.client.codigo ? `${a.client.codigo} - ${a.client.name}` : a.client.name}
                </label>
                <button onClick={() => removeMutation.mutate(a.id)} className="text-muted-foreground hover:text-danger-text flex-shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="px-4 py-3 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Vincular novo cliente</Label>
        <div className="grid grid-cols-2 gap-2">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
            <option value="">Cliente</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
          </select>
        </div>
        <Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || addMutation.isPending}>
          Vincular cliente
        </Button>
      </Card>

      <Card className="px-4 py-3 space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <History size={12} /> Log de geração
        </Label>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma geração registrada ainda.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className={`text-xs rounded px-2 py-1 ${l.status === 'FAILED' ? 'bg-danger-bg text-danger-text' : 'bg-success-bg text-success-text'}`}>
                {new Date(l.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {l.status === 'FAILED' ? l.errorMessage : 'Gerado com sucesso'}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Remover `ManageTemplateDialog` de `RecurringTemplates.tsx`, trocar botão por link**

Em `apps/web/src/pages/app/settings/RecurringTemplates.tsx`:
- Remover o import `Dialog, DialogContent, DialogHeader, DialogTitle` se não for mais usado em nenhum outro lugar do arquivo (confirmar antes de remover).
- Remover os imports de tipos que só a `ManageTemplateDialog` usava (`RecurringTaskAssignment`, `RecurringGenerationLog`, `Client` — confirmar que `RecurringTaskTemplate` continua sendo usado pelo resto do arquivo).
- Remover o state `const [managing, setManaging] = useState<RecurringTaskTemplate | null>(null)` e o render condicional `{managing && <ManageTemplateDialog ... />}` no final do componente principal.
- Remover a função `ManageTemplateDialog` inteira (do `function ManageTemplateDialog(...)` até o fechamento correspondente, no final do arquivo).
- Trocar o botão:

```tsx
                <button onClick={() => setManaging(t)} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Vínculos e log">
                  <Users size={14} />
                </button>
```

por:

```tsx
                <Link to={`/app/settings/recurring-templates/${t.id}/manage`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Vínculos e log">
                  <Users size={14} />
                </Link>
```

(`Link` já está importado no topo do arquivo, junto com `useNavigate`, de `react-router-dom`).

- [ ] **Step 3: Rota nova em `router.tsx`**

Adicionar import:

```ts
import RecurringTemplateManage from '@/pages/app/settings/RecurringTemplateManage'
```

E, logo depois do bloco de rota `settings/recurring-templates/:id/edit`, adicionar:

```tsx
      {
        path: 'settings/recurring-templates/:id/manage',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <RecurringTemplateManage />
          </ProtectedRoute>
        ),
      },
```

- [ ] **Step 4: Typecheck e smoke test visual**

```bash
pnpm --filter web exec tsc --noEmit
```

Via Playwright (dev servers já rodando): login, ir em `/app/settings/recurring-templates`, clicar no ícone de vínculos de um template — confirma que navega (não abre mais dialog), a página carrega, o seletor de mês aparece com o mês atual, a busca filtra a lista, marcar um checkbox e clicar "Gerar selecionados" mostra o toast de resumo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/settings/RecurringTemplateManage.tsx apps/web/src/pages/app/settings/RecurringTemplates.tsx apps/web/src/router.tsx
git commit -m "feat(recurring-templates): página de gestão substitui o popup de vínculos

Lista com busca por nome, seleção múltipla via checkbox, seletor de
mês de vencimento, geração em lote, e banner persistente de falhas
não resolvidas desse template específico.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend — console global de geração

**Files:**
- Create: `apps/web/src/pages/app/settings/RecurringGenerationConsole.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Consumes (de Task 3): `POST /recurring-templates/bulk-generate`, `GET /recurring-templates/failed-generations`, `GET /recurring-templates` (lista de templates ativos, já existe).
- Consumes (de Task 5): `BulkGenerationSummary`, `FailedGeneration` de `@/types`.
- Produces: rota `/app/settings/recurring-generation` — Task 8 (hub) linka pra essa rota.

- [ ] **Step 1: Criar `RecurringGenerationConsole.tsx`**

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringTaskTemplate, BulkGenerationSummary, FailedGeneration } from '@/types'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal', MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', ANNUAL: 'Anual',
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthValueToISO(monthValue: string): string {
  return new Date(`${monthValue}-01T00:00:00.000Z`).toISOString()
}

export default function RecurringGenerationConsole() {
  const qc = useQueryClient()
  const [dueMonth, setDueMonth] = useState(currentMonthValue())
  const [lastRun, setLastRun] = useState<BulkGenerationSummary[] | null>(null)

  const { data: templates = [] } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })
  const activeTemplates = templates.filter((t) => t.isActive)

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
  })

  const failuresByTemplate = failures.reduce<Record<string, { title: string; items: FailedGeneration[] }>>((acc, f) => {
    if (!acc[f.templateId]) acc[f.templateId] = { title: f.templateTitle, items: [] }
    acc[f.templateId].items.push(f)
    return acc
  }, {})

  const runAllMutation = useMutation({
    mutationFn: () => api.post<BulkGenerationSummary[]>('/recurring-templates/bulk-generate', { dueMonth: monthValueToISO(dueMonth) }).then((r) => r.data),
    onSuccess: (summaries) => {
      setLastRun(summaries)
      const totalGenerated = summaries.reduce((acc, s) => acc + s.result.generated, 0)
      const totalFailed = summaries.reduce((acc, s) => acc + s.result.failed.length, 0)
      toast.success(`${totalGenerated} tarefas geradas em ${summaries.length} templates, ${totalFailed} falharam`)
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar em lote')
    },
  })

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/settings" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">Geração manual</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Ferramenta de exceção — recuperar uma geração que o cron não fez, ou adiantar um mês inteiro antes do disparo automático. Roda todos os templates ativos de uma vez.
      </p>

      {Object.keys(failuresByTemplate).length > 0 && (
        <Card className="border-danger-text bg-danger-bg px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-danger-text font-medium text-sm">
            <AlertTriangle size={16} />
            Falhas pendentes
          </div>
          {Object.entries(failuresByTemplate).map(([templateId, { title, items }]) => (
            <div key={templateId} className="text-xs text-danger-text">
              <Link to={`/app/settings/recurring-templates/${templateId}/manage`} className="underline font-medium">{title}</Link>
              {' — '}{items.length} {items.length === 1 ? 'falha' : 'falhas'}
            </div>
          ))}
        </Card>
      )}

      <Card className="px-4 py-3 space-y-3">
        <div className="space-y-1.5">
          <Label>Mês de vencimento</Label>
          <input
            type="month"
            value={dueMonth}
            onChange={(e) => setDueMonth(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          {activeTemplates.map((t) => (
            <div key={t.id} className="text-sm bg-neutral-bg rounded px-2 py-1.5">
              {t.title} — {PERIODICITY_LABEL[t.periodicity]} · {t.department.name}
            </div>
          ))}
          {activeTemplates.length === 0 && <p className="text-xs text-muted-foreground">Nenhum template ativo.</p>}
        </div>

        <Button type="button" onClick={() => runAllMutation.mutate()} disabled={activeTemplates.length === 0 || runAllMutation.isPending}>
          {runAllMutation.isPending ? 'Gerando...' : 'Gerar todos'}
        </Button>
      </Card>

      {lastRun && (
        <Card className="px-4 py-3 space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Resultado da última execução</Label>
          {lastRun.map((s) => (
            <div key={s.templateId} className="text-xs bg-neutral-bg rounded px-2 py-1.5">
              <span className="font-medium">{s.templateTitle}</span> — {s.result.generated} geradas, {s.result.alreadyExists} já existiam, {s.result.failed.length} falharam
              {s.result.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-danger-text">
                  {s.result.failed.map((f, i) => <li key={i}>• {f.clientName}: {f.errorMessage}</li>)}
                </ul>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rota nova em `router.tsx`**

Adicionar import:

```ts
import RecurringGenerationConsole from '@/pages/app/settings/RecurringGenerationConsole'
```

E adicionar, no mesmo bloco de children de `/app`:

```tsx
      {
        path: 'settings/recurring-generation',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <RecurringGenerationConsole />
          </ProtectedRoute>
        ),
      },
```

- [ ] **Step 3: Typecheck e smoke test visual**

```bash
pnpm --filter web exec tsc --noEmit
```

Via Playwright: navegar direto pra `/app/settings/recurring-generation`, confirmar que lista os templates ativos, seletor de mês funciona, "Gerar todos" mostra resultado inline por template.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/RecurringGenerationConsole.tsx apps/web/src/router.tsx
git commit -m "feat(recurring-templates): console global de geração manual

Ferramenta de exceção pra rodar todos os templates ativos de uma vez
num mês escolhido — recuperar cron que falhou ou adiantar geração.
Mostra falhas pendentes agrupadas por template no topo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — hub de Configurações + badge de falhas na sidebar

**Files:**
- Create: `apps/web/src/pages/app/settings/SettingsHub.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`
- Modify: `apps/web/src/pages/app/settings/Subscription.tsx`
- Modify: `apps/web/src/pages/app/settings/Departments.tsx`
- Modify: `apps/web/src/pages/app/settings/ClientUsers.tsx`
- Modify: `apps/web/src/pages/app/settings/RecurringTemplates.tsx`
- Modify: `apps/web/src/pages/app/settings/OSTemplates.tsx`

**Interfaces:**
- Consumes (de Task 3): `GET /recurring-templates/failed-generations` (pro badge).
- Consumes (de Task 6/7): rotas `/app/settings/recurring-templates` e `/app/settings/recurring-generation` (cards do hub linkam pra lá).
- Produces: rota `/app/settings` — ponto de entrada único da sidebar pra toda a área de configurações.

- [ ] **Step 1: Criar `SettingsHub.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Settings, Bell, CreditCard, Building2, UserCog, Repeat, FileStack, Zap } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { FailedGeneration } from '@/types'

const ADMIN_ROLES = ['ORG_ADMIN']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

interface SettingsCard {
  to: string
  icon: React.ReactNode
  title: string
  description: string
  roles: string[]
  badge?: number
}

export default function SettingsHub() {
  const { user } = useAuth()
  const role = user?.role ?? ''

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: ADMIN_ROLES.includes(role),
  })

  const cards: SettingsCard[] = [
    { to: '/app/settings/templates', icon: <Settings size={20} />, title: 'Templates', description: 'Mensagens de notificação por evento', roles: ADMIN_ROLES },
    { to: '/app/settings/notifications', icon: <Bell size={20} />, title: 'Notificações', description: 'WhatsApp e e-mail por organização', roles: ADMIN_ROLES },
    { to: '/app/settings/subscription', icon: <CreditCard size={20} />, title: 'Assinatura', description: 'Plano e cobrança', roles: ADMIN_ROLES },
    { to: '/app/settings/departments', icon: <Building2 size={20} />, title: 'Departamentos', description: 'Áreas internas do escritório', roles: ADMIN_ROLES },
    { to: '/app/settings/client-users', icon: <UserCog size={20} />, title: 'Usuários de Cliente', description: 'Acessos do portal do cliente', roles: MANAGER_ROLES },
    { to: '/app/settings/recurring-templates', icon: <Repeat size={20} />, title: 'Tarefas Recorrentes', description: 'Templates de geração automática', roles: ADMIN_ROLES },
    { to: '/app/settings/os-templates', icon: <FileStack size={20} />, title: 'Templates de OS', description: 'Modelos de ordem de serviço', roles: ADMIN_ROLES },
    { to: '/app/settings/recurring-generation', icon: <Zap size={20} />, title: 'Geração manual', description: 'Rodar geração de tarefas recorrentes fora do ciclo automático', roles: ADMIN_ROLES, badge: failures.length },
  ]

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground mb-4">Configurações</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.filter((c) => c.roles.includes(role)).map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="p-4 h-full hover:border-accent transition-colors">
              <div className="flex items-start justify-between">
                <div className="text-accent mb-2">{c.icon}</div>
                {!!c.badge && c.badge > 0 && (
                  <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-text text-danger-foreground text-xs font-medium flex items-center justify-center">
                    {c.badge > 9 ? '9+' : c.badge}
                  </span>
                )}
              </div>
              <h2 className="text-sm font-medium text-foreground">{c.title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Colapsar a sidebar em `AppLayout.tsx`**

Trocar o bloco inteiro (da `SidebarSectionLabel('Configurações')` até o último `SidebarLink` de `os-templates`):

```tsx
          {ADMIN_ROLES.includes(role) && (
            <SidebarSectionLabel>Configurações</SidebarSectionLabel>
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/templates" icon={<Settings size={16} />} label="Templates" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/notifications" icon={<Bell size={16} />} label="Notificações" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/subscription" icon={<CreditCard size={16} />} label="Assinatura" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/departments" icon={<Building2 size={16} />} label="Departamentos" onClick={handleNavClick} />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/client-users" icon={<UserCog size={16} />} label="Usuários de Cliente" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/recurring-templates" icon={<Repeat size={16} />} label="Tarefas Recorrentes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/os-templates" icon={<FileStack size={16} />} label="Templates de OS" onClick={handleNavClick} />
          )}
```

por:

```tsx
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink
              to="/app/settings"
              icon={<Settings size={16} />}
              label="Configurações"
              badge={failedGenerationsCount}
              onClick={handleNavClick}
            />
          )}
```

(gate em `MANAGER_ROLES` em vez de `ADMIN_ROLES` — um `ORG_MANAGER` continua precisando acessar "Usuários de Cliente", que é o único card do hub que ele tem permissão de ver; o hub em si filtra os cards por role, igual ao `ProtectedRoute` de cada rota já fazia antes).

Como os imports `Bell`, `CreditCard`, `Building2`, `UserCog`, `Repeat`, `FileStack` deixam de ser usados diretamente em `AppLayout.tsx` (só `Settings` continua, pro ícone do link único), remover esses do import de `lucide-react` no topo do arquivo — manter só os que continuam em uso (`LayoutDashboard, Users, UserCheck, Bell` — **conferir se `Bell` ainda é usado em outro lugar do arquivo antes de remover**, o restante do import deve ser conferido um por um contra o resto do arquivo).

Adicionar a query do contador de falhas, logo depois do `useQuery` de `pendingCount` já existente:

```tsx
  const { data: failedGenerations } = useQuery<{ length: number }>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
    enabled: ADMIN_ROLES.includes(role),
    refetchOnWindowFocus: true,
  })
  const failedGenerationsCount = failedGenerations?.length ?? 0
```

(`ADMIN_ROLES` já está declarado no topo do arquivo — essa query só roda pra admin, já que é quem pode agir sobre as falhas; um manager vê o link "Configurações" sem badge).

- [ ] **Step 3: Rota do hub em `router.tsx`**

Adicionar import:

```ts
import SettingsHub from '@/pages/app/settings/SettingsHub'
```

Adicionar, como primeiro item do bloco de rotas `settings/*`:

```tsx
      {
        path: 'settings',
        element: (
          <ProtectedRoute allowedRoles={MANAGER_ROLES}>
            <SettingsHub />
          </ProtectedRoute>
        ),
      },
```

- [ ] **Step 4: Link "← Configurações" nas páginas individuais**

Em cada um dos 8 arquivos listados em "Files" acima (exceto `RecurringTemplateManage.tsx`/`RecurringGenerationConsole.tsx`, que já ganharam seu próprio "← Voltar" nas tasks 6/7), localizar o cabeçalho (`<h1>` do título da página) e adicionar, logo acima ou ao lado, um link de volta:

```tsx
<Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
  <ArrowLeft size={12} /> Configurações
</Link>
```

Ajustar o import de `Link`/`ArrowLeft` de `react-router-dom`/`lucide-react` em cada arquivo conforme necessário (alguns já importam `Link` por outro motivo — conferir antes de duplicar import). Esse passo é mecânico e repetitivo — aplicar o mesmo padrão visual nos 8 arquivos, adaptando à estrutura de cabeçalho já existente em cada um (nem todos têm exatamente o mesmo layout de header).

- [ ] **Step 5: Typecheck e smoke test visual**

```bash
pnpm --filter web exec tsc --noEmit
```

Via Playwright: login como ORG_ADMIN, confirmar que a sidebar mostra só "Configurações" (sem os 7 links antigos), clicar nele vai pro hub com 8 cards, o card "Geração manual" mostra badge se houver falha pendente (gerar uma falha de propósito pra testar — ex. tentar gerar duas vezes seguidas a mesma competência não conta como falha, usar um cenário que force `FAILED` de verdade é mais trabalhoso; validar ao menos que o badge aparece com `count=0` sem erro, e que navegar funciona). Confirmar que um `ORG_MANAGER` vê o link "Configurações" na sidebar e, ao entrar no hub, só vê o card "Usuários de Cliente".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/app/settings/SettingsHub.tsx apps/web/src/components/AppLayout.tsx apps/web/src/router.tsx apps/web/src/pages/app/settings/Templates.tsx apps/web/src/pages/app/settings/Notifications.tsx apps/web/src/pages/app/settings/Subscription.tsx apps/web/src/pages/app/settings/Departments.tsx apps/web/src/pages/app/settings/ClientUsers.tsx apps/web/src/pages/app/settings/RecurringTemplates.tsx apps/web/src/pages/app/settings/OSTemplates.tsx
git commit -m "feat(settings): hub de Configurações substitui os 7 links da sidebar

Sidebar ganha um único item 'Configurações' com badge de falhas de
geração recorrente não resolvidas. /app/settings lista as 8 opções
em cards, cada uma com sua role já existente preservada.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificação final (depois de todas as tasks)

```bash
pnpm --filter api test
pnpm --filter web test
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Smoke test manual completo via Playwright, roteiro: login → hub de Configurações → criar template de recorrência com `competenceMonthOffset`/`generationMonthOffset` configurados pro cenário DAS (dia 20, antecedência 1, vencimento dia 10, competência 1 mês antes) → ir na página de gestão do template → vincular 2 clientes → selecionar os 2 → escolher mês de vencimento → gerar em lote → conferir toast + log de geração mostrando a competência certa → ir no console global → conferir que o template aparece na lista → voltar pro board do cliente e confirmar que a tarefa gerada tem vencimento no mês escolhido, não no passado.
