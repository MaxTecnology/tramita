# Design — Dashboard com Métricas + Página de Processos

**Data:** 2026-06-04
**Status:** Aprovado para implementação

---

## Contexto

O dashboard atual exibe um grid de processos (boards) com barra de progresso e botão de exportar PDF. Com o crescimento do número de clientes, essa tela acumula duas responsabilidades conflitantes: visão gerencial e listagem operacional.

Este design separa as duas em páginas distintas:
- `/app/dashboard` — visão de métricas e alertas (novo)
- `/app/processes` — listagem filtrável e agrupada de processos (novo)

---

## Dashboard (`/app/dashboard`)

### Layout

```
┌─────────────────────────────────────────────────┐
│  [KPI]  [KPI]  [KPI]  [KPI]                    │
│─────────────────────────────────────────────────│
│                          │                      │
│  Gráfico de barras       │  Em risco            │
│  (tarefas por status)    │  (alertas)           │
│                          │                      │
└─────────────────────────────────────────────────┘
```

### KPI Cards (linha superior, 4 cards)

| Card | Cálculo | Cor de destaque |
|---|---|---|
| Processos ativos | `COUNT(boards WHERE isActive = true)` | azul |
| Atrasados | `COUNT DISTINCT boards` com ≥1 tarefa onde `dueDate < now AND status != DONE` | amarelo |
| Concluídos no mês | `COUNT tasks WHERE status = DONE AND updatedAt >= início do mês corrente` | verde |
| Tarefas urgentes abertas | `COUNT tasks WHERE priority = URGENT AND status != DONE` | vermelho |

### Gráfico de barras — Tarefas por status

Exibe 4 barras: OPEN, IN_PROGRESS, REVIEW, DONE.

Cada barra = quantidade total de tarefas naquele status, em todos os boards ativos da org.

Labels em português: Aberto, Em andamento, Revisão, Concluído.

Implementação: barras CSS puras (sem biblioteca de gráficos externa) — simples, sem dependência adicional.

### Painel "Em risco" (lateral direita)

Lista de processos com tarefas vencidas ou vencendo em ≤ 7 dias, ordenados por urgência:

1. Vencidos (dueDate < hoje) — borda vermelha
2. Vence hoje — borda vermelha
3. Vence em 1-7 dias — borda laranja

Cada item exibe: nome do processo, nome do cliente, descrição do prazo ("Vencido há 2 dias", "Vence amanhã").

Clicável — navega para `/app/board/:boardId`.

Link "Ver todos os processos" no rodapé do painel → `/app/processes`.

Limite de exibição: 8 itens (scroll interno se mais).

---

## Página de Processos (`/app/processes`)

### Layout

```
┌─────────────────────────────────────────────────┐
│  [Busca]  [Cliente ▾]  [Colaborador ▾]          │
│           [Etapa ▾]    [⚠ Atrasados]  [+ Novo]  │
│─────────────────────────────────────────────────│
│  ⚠ Atrasados (2)                               │
│  ├─ Regularização CNPJ · Empresa X · 65% · 2d  │
│  └─ Abertura de Empresa · Empresa W · 20% · 1d │
│                                                 │
│  ⏰ Vence em 7 dias (3)                        │
│  ├─ Alvará de Funcionamento · 90% · amanhã     │
│  └─ ...                                         │
│                                                 │
│  📋 Em andamento (19) ▾                        │
│  └─ (colapsável)                               │
│                                                 │
│  ✓ Concluídos (8) ▾                            │
│  └─ (colapsado por padrão)                     │
└─────────────────────────────────────────────────┘
```

### Barra de filtros

- **Busca textual**: filtra por nome do processo ou nome do cliente (debounce 300ms)
- **Cliente**: dropdown com lista de clientes da org
- **Colaborador**: dropdown com usuários da org (visível apenas para ORG_ADMIN e ORG_MANAGER)
- **Etapa**: dropdown com nomes de colunas distintos dos boards ativos da org
- **Botão "Atrasados"**: toggle — quando ativo, exibe apenas o grupo "Atrasados"
- **Botão "+ Novo Processo"**: modal de criação (migrado do dashboard atual)

### Agrupamento padrão (sem filtro ativo)

| Grupo | Critério | Header | Estado inicial |
|---|---|---|---|
| Atrasados | ≥1 tarefa com `dueDate < hoje` e `status != DONE` | vermelho | expandido |
| Vence em 7 dias | ≥1 tarefa com `dueDate entre hoje e +7 dias` e `status != DONE` | laranja | expandido |
| Em andamento | demais boards ativos sem tarefas vencidas | azul | expandido |
| Concluídos | todos os boards onde progresso = 100% | cinza | colapsado |

Quando filtro ativo: agrupamento some, exibe lista plana ordenada por prazo mais urgente primeiro.

### Colunas da tabela

| Coluna | Dado |
|---|---|
| Processo | `board.title` |
| Cliente | `board.client.name` |
| Etapa atual | nome da coluna com maior número de tarefas abertas (`status != DONE`) |
| Responsável | `board.responsibleUser.name` ou "—" |
| Progresso | barra + percentual `(tarefas DONE / total) * 100` |
| Prazo | data da tarefa mais urgente em aberto; cor: vermelho = vencido, laranja = ≤7 dias, cinza = ok |

Clique na linha → navega para `/app/board/:boardId`.

---

## Backend — Novos endpoints

### `GET /dashboard/metrics`

Retorna todos os dados do dashboard em uma única chamada:

```typescript
{
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  },
  tasksByStatus: {
    OPEN: number
    IN_PROGRESS: number
    REVIEW: number
    DONE: number
  },
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    daysOverdue: number        // negativo = vence em X dias, positivo = venceu há X dias
    mostUrgentDueDate: string
  }>
}
```

Middleware: `verifyJWT` + `requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')`.

### `GET /boards` — extensão dos filtros existentes

Adicionar query params:

| Param | Tipo | Descrição |
|---|---|---|
| `clientId` | string | filtrar por cliente |
| `responsibleUserId` | string | filtrar por colaborador responsável |
| `columnTitle` | string | filtrar por etapa (nome da coluna, case-insensitive, match parcial) |
| `overdue` | boolean | apenas boards com tarefas vencidas |
| `dueSoon` | boolean | apenas boards com tarefas vencendo em ≤7 dias |

O response de `GET /boards` já inclui colunas e tarefas — o frontend calcula "etapa atual" e "progresso" localmente com os dados que já chegam.

---

## Navegação e rotas

### Frontend — novas rotas

```
/app/dashboard   → DashboardMetrics.tsx (novo componente)
/app/processes   → Processes.tsx (novo componente)
/app/board/:id   → Board.tsx (inalterado)
```

O componente `Dashboard.tsx` atual é **renomeado** para `Processes.tsx` e adaptado (grid → tabela agrupada). O novo `DashboardMetrics.tsx` é criado do zero.

### Menu lateral (sidebar)

Adicionar item "Processos" com link para `/app/processes`. O item "Dashboard" existente aponta para `/app/dashboard`.

---

## Permissões

| Elemento | ORG_ADMIN | ORG_MANAGER | ORG_MEMBER |
|---|---|---|---|
| Ver dashboard | ✅ | ✅ | ✅ |
| Ver filtro "Colaborador" | ✅ | ✅ | ❌ |
| Criar processo | ✅ | ✅ | ❌ |
| Ver todos os processos | ✅ | ✅ | apenas os que tem tarefa atribuída |

> **Nota:** ORG_MEMBER vê apenas processos onde é `assignee` de alguma tarefa ou `responsibleUser` do board. Isso requer filtro adicional no backend quando `role = ORG_MEMBER`.

---

## O que NÃO está no escopo

- Gráficos com biblioteca externa (Recharts, Chart.js) — barras CSS são suficientes
- Dashboard do portal do cliente (separado, não afetado)
- Exportação de relatório do dashboard (já existe no card do processo)
- Notificações push sobre alertas (feature futura)
