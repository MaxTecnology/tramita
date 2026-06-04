# Dashboard com Métricas + Página de Processos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar o dashboard atual em duas páginas: `/app/dashboard` com métricas/gráficos/alertas e `/app/processes` com listagem filtrável e agrupada de processos.

**Architecture:** Backend recebe um novo módulo `dashboard` com endpoint de métricas agregadas, e o `listBoards` é extendido com filtros de coluna, overdue e dueSoon. No frontend, o `Dashboard.tsx` atual vira `Processes.tsx` (tabela agrupada) e um novo `DashboardMetrics.tsx` é criado do zero com KPIs em CSS puro.

**Tech Stack:** Fastify v5, Prisma v6, React 19, TanStack Query, TailwindCSS v4, lucide-react

---

## Mapa de Arquivos

**Backend:**
- Create: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/api/src/server.ts` — registrar dashboardRoutes
- Modify: `apps/api/src/modules/boards/boards.schema.ts` — adicionar `listBoardsQuerySchema`
- Modify: `apps/api/src/modules/boards/boards.service.ts` — extender `listBoards` com novos filtros e include de `responsibleUser`
- Modify: `apps/api/src/modules/boards/boards.routes.ts` — passar query params para `listBoards`

**Frontend:**
- Create: `apps/web/src/pages/app/DashboardMetrics.tsx` — nova página de métricas
- Create: `apps/web/src/pages/app/Processes.tsx` — listagem com filtros e agrupamento
- Modify: `apps/web/src/router.tsx` — adicionar rota `/app/processes`, atualizar `/app/dashboard`
- Modify: `apps/web/src/components/AppLayout.tsx` — adicionar link "Processos" na sidebar
- Modify: `apps/web/src/types/index.ts` — adicionar campo `responsibleUser` ao tipo `Board`

---

## Task 1: Backend — Módulo dashboard com endpoint de métricas

**Files:**
- Create: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Create: `apps/api/src/modules/dashboard/dashboard.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Criar `apps/api/src/modules/dashboard/dashboard.service.ts`**

```typescript
import { prisma } from '@/lib/prisma'

export async function getDashboardMetrics(organizationId: string) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [
    activeBoards,
    overdueBoards,
    completedThisMonth,
    urgentOpen,
    tasksByStatus,
    atRiskBoards,
  ] = await Promise.all([
    prisma.board.count({ where: { organizationId, isActive: true } }),

    prisma.board.count({
      where: {
        organizationId,
        isActive: true,
        columns: {
          some: {
            tasks: {
              some: { dueDate: { lt: now }, status: { notIn: ['DONE', 'CANCELLED'] } },
            },
          },
        },
      },
    }),

    prisma.task.count({
      where: {
        status: 'DONE',
        updatedAt: { gte: startOfMonth },
        column: { board: { organizationId, isActive: true } },
      },
    }),

    prisma.task.count({
      where: {
        priority: 'URGENT',
        status: { notIn: ['DONE', 'CANCELLED'] },
        column: { board: { organizationId, isActive: true } },
      },
    }),

    prisma.task.groupBy({
      by: ['status'],
      where: { column: { board: { organizationId, isActive: true } } },
      _count: { status: true },
    }),

    prisma.board.findMany({
      where: {
        organizationId,
        isActive: true,
        columns: {
          some: {
            tasks: {
              some: { dueDate: { lte: in7days }, status: { notIn: ['DONE', 'CANCELLED'] } },
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        client: { select: { name: true } },
        columns: {
          select: {
            tasks: {
              where: { dueDate: { not: null }, status: { notIn: ['DONE', 'CANCELLED'] } },
              select: { dueDate: true },
              orderBy: { dueDate: 'asc' },
            },
          },
        },
      },
      take: 8,
    }),
  ])

  const statusMap: Record<string, number> = {}
  for (const g of tasksByStatus) {
    statusMap[g.status] = g._count.status
  }

  const atRisk = atRiskBoards
    .map((b) => {
      const allDueDates = b.columns
        .flatMap((c) => c.tasks)
        .map((t) => new Date(t.dueDate!))
        .sort((a, z) => a.getTime() - z.getTime())
      const earliest = allDueDates[0] ?? null
      const daysOverdue = earliest
        ? Math.floor((now.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24))
        : 0
      return {
        boardId: b.id,
        boardTitle: b.title,
        clientName: b.client.name,
        mostUrgentDueDate: earliest?.toISOString() ?? null,
        daysOverdue,
      }
    })
    .sort((a, z) => z.daysOverdue - a.daysOverdue)

  return {
    kpis: {
      activeBoards,
      overdueBoards,
      completedTasksThisMonth: completedThisMonth,
      urgentOpenTasks: urgentOpen,
    },
    tasksByStatus: {
      OPEN: statusMap['OPEN'] ?? 0,
      IN_PROGRESS: statusMap['IN_PROGRESS'] ?? 0,
      REVIEW: statusMap['REVIEW'] ?? 0,
      DONE: statusMap['DONE'] ?? 0,
    },
    atRisk,
  }
}
```

- [ ] **Criar `apps/api/src/modules/dashboard/dashboard.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { getDashboardMetrics } from './dashboard.service'

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/metrics', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await getDashboardMetrics(request.user.organizationId!))
  })
}
```

- [ ] **Registrar em `apps/api/src/server.ts`**

Adicionar import e registro logo após `reportsRoutes`:

```typescript
import { dashboardRoutes } from '@/modules/dashboard/dashboard.routes'
// ...
app.register(dashboardRoutes, { prefix: '/dashboard' })
```

- [ ] **Verificar TypeScript**

```bash
pnpm --filter api build 2>&1 | head -20
```

Esperado: sem erros relacionados aos novos arquivos.

- [ ] **Commit**

```bash
git add apps/api/src/modules/dashboard/ apps/api/src/server.ts
git commit -m "feat: GET /dashboard/metrics com KPIs, status e alertas"
```

---

## Task 2: Backend — Extender listBoards com novos filtros

**Files:**
- Modify: `apps/api/src/modules/boards/boards.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/boards/boards.routes.ts`

- [ ] **Adicionar `listBoardsQuerySchema` em `boards.schema.ts`**

Adicionar ao final do arquivo:

```typescript
export const listBoardsQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  responsibleUserId: z.string().cuid().optional(),
  columnTitle: z.string().optional(),
  overdue: z.coerce.boolean().optional(),
  dueSoon: z.coerce.boolean().optional(),
})

export type ListBoardsQuery = z.infer<typeof listBoardsQuerySchema>
```

- [ ] **Atualizar `listBoards` em `boards.service.ts`**

Substituir a função `listBoards` atual por:

```typescript
export async function listBoards(
  organizationId: string,
  query: {
    clientId?: string
    responsibleUserId?: string
    columnTitle?: string
    overdue?: boolean
    dueSoon?: boolean
  } = {},
) {
  const now = new Date()
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}),
      ...(query.columnTitle
        ? {
            columns: {
              some: {
                title: { contains: query.columnTitle, mode: 'insensitive' },
                tasks: { some: { status: { notIn: ['DONE', 'CANCELLED'] } } },
              },
            },
          }
        : {}),
      ...(query.overdue
        ? {
            columns: {
              some: {
                tasks: {
                  some: { dueDate: { lt: now }, status: { notIn: ['DONE', 'CANCELLED'] } },
                },
              },
            },
          }
        : {}),
      ...(query.dueSoon
        ? {
            columns: {
              some: {
                tasks: {
                  some: {
                    dueDate: { gte: now, lte: in7days },
                    status: { notIn: ['DONE', 'CANCELLED'] },
                  },
                },
              },
            },
          }
        : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Atualizar rota GET / em `boards.routes.ts`**

Substituir o handler do `app.get('/', ...)` por:

```typescript
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { organizationId, role, sub } = request.user

    const rawQuery = listBoardsQuerySchema.safeParse(request.query)
    const query = rawQuery.success ? rawQuery.data : {}

    // CLIENT always sees only their own boards
    if (role === 'CLIENT') {
      return reply.send(await listBoards(organizationId!, { clientId: sub }))
    }

    // ORG_MEMBER always sees only boards they are responsible for
    if (role === 'ORG_MEMBER') {
      return reply.send(await listBoards(organizationId!, { ...query, responsibleUserId: sub }))
    }

    return reply.send(await listBoards(organizationId!, query))
  })
```

E adicionar o import do novo schema no topo do routes:

```typescript
import { createBoardSchema, updateBoardSchema, searchQuerySchema, listBoardsQuerySchema } from './boards.schema'
```

- [ ] **Verificar TypeScript**

```bash
pnpm --filter api build 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add apps/api/src/modules/boards/
git commit -m "feat: listBoards aceita filtros columnTitle, overdue e dueSoon; inclui responsibleUser"
```

---

## Task 3: Frontend — Tipos, rotas e navegação

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Adicionar `responsibleUser` ao tipo `Board` em `types/index.ts`**

Substituir a interface `Board`:

```typescript
export interface Board {
  id: string
  title: string
  description: string | null
  clientId: string
  organizationId: string
  responsibleUserId: string | null
  responsibleUser: { id: string; name: string } | null
  isActive: boolean
  columns: Column[]
  client: { id: string; name: string }
}
```

- [ ] **Adicionar rota `/app/processes` em `router.tsx`**

No topo, adicionar os imports:

```typescript
import Processes from '@/pages/app/Processes'
import DashboardMetrics from '@/pages/app/DashboardMetrics'
```

Dentro do array `children` do `/app`, substituir a rota `dashboard` e adicionar `processes`:

```typescript
      { path: 'dashboard', element: <DashboardMetrics /> },
      { path: 'processes', element: <Processes /> },
```

- [ ] **Adicionar "Processos" na sidebar de `AppLayout.tsx`**

Adicionar import do ícone `ClipboardList`:

```typescript
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList } from 'lucide-react'
```

Adicionar link de Processos logo após o link de Dashboard:

```tsx
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/processes" icon={<ClipboardList size={16} />} label="Processos" />
          )}
```

- [ ] **Verificar build do frontend**

```bash
pnpm --filter web build 2>&1 | grep -E "error|Error" | head -10
```

Esperado: nenhum erro.

- [ ] **Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat: rota /app/processes, link na sidebar, tipo Board com responsibleUser"
```

---

## Task 4: Frontend — Página DashboardMetrics

**Files:**
- Create: `apps/web/src/pages/app/DashboardMetrics.tsx`

- [ ] **Criar `apps/web/src/pages/app/DashboardMetrics.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Metrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    IN_PROGRESS: number
    REVIEW: number
    DONE: number
  }
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    mostUrgentDueDate: string | null
    daysOverdue: number
  }>
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Andamento',
  REVIEW: 'Revisão',
  DONE: 'Concluído',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-400',
  IN_PROGRESS: 'bg-amber-400',
  REVIEW: 'bg-violet-400',
  DONE: 'bg-emerald-400',
}

function formatDaysOverdue(daysOverdue: number, dueDate: string | null): string {
  if (!dueDate) return ''
  if (daysOverdue > 0) return `Vencido há ${daysOverdue}d`
  if (daysOverdue === 0) return 'Vence hoje'
  return `Vence em ${Math.abs(daysOverdue)}d`
}

export default function DashboardMetrics() {
  const { data, isLoading } = useQuery<Metrics>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.get('/dashboard/metrics').then((r) => r.data),
    refetchInterval: 60_000,
  })

  if (isLoading || !data) {
    return <div className="p-8 text-gray-500">Carregando métricas...</div>
  }

  const { kpis, tasksByStatus, atRisk } = data

  const maxTaskCount = Math.max(...Object.values(tasksByStatus), 1)

  const kpiCards = [
    { label: 'Processos ativos', value: kpis.activeBoards, color: 'border-blue-500', textColor: 'text-blue-600' },
    { label: 'Atrasados', value: kpis.overdueBoards, color: 'border-amber-500', textColor: 'text-amber-600' },
    { label: 'Concluídos no mês', value: kpis.completedTasksThisMonth, color: 'border-emerald-500', textColor: 'text-emerald-600' },
    { label: 'Tarefas urgentes abertas', value: kpis.urgentOpenTasks, color: 'border-red-500', textColor: 'text-red-600' },
  ]

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div key={card.label} className={cn('bg-white rounded-lg border-l-4 p-4 shadow-sm', card.color)}>
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={cn('text-3xl font-bold mt-1', card.textColor)}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de barras — tarefas por status */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Tarefas por status</h2>
          <div className="flex items-end gap-6 h-40">
            {Object.entries(tasksByStatus).map(([status, count]) => (
              <div key={status} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-sm font-semibold text-gray-700">{count}</span>
                <div className="w-full flex items-end" style={{ height: '100px' }}>
                  <div
                    className={cn('w-full rounded-t-md transition-all', STATUS_COLORS[status])}
                    style={{ height: `${Math.max((count / maxTaskCount) * 100, count > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">{STATUS_LABELS[status]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Painel em risco */}
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Em risco</h2>
            <Link to="/app/processes?overdue=true" className="text-xs text-blue-600 hover:underline">
              Ver todos
            </Link>
          </div>

          {atRisk.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum processo em risco 🎉</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-72">
              {atRisk.map((item) => {
                const isOverdue = item.daysOverdue > 0
                return (
                  <Link
                    key={item.boardId}
                    to={`/app/board/${item.boardId}`}
                    className={cn(
                      'block rounded-md p-3 border-l-2 hover:bg-gray-50 transition-colors',
                      isOverdue ? 'border-red-500 bg-red-50' : 'border-amber-400 bg-amber-50',
                    )}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{item.boardTitle}</p>
                    <p className="text-xs text-gray-500 truncate">{item.clientName}</p>
                    <p className={cn('text-xs font-medium mt-0.5', isOverdue ? 'text-red-600' : 'text-amber-600')}>
                      {formatDaysOverdue(item.daysOverdue, item.mostUrgentDueDate)}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}

          <Link
            to="/app/processes"
            className="mt-3 block text-center text-xs text-blue-600 hover:underline"
          >
            Ver todos os processos →
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Verificar build**

```bash
pnpm --filter web build 2>&1 | grep -E "error|Error" | head -10
```

- [ ] **Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat: DashboardMetrics com KPIs, gráfico de barras e painel de alertas"
```

---

## Task 5: Frontend — Página Processes (tabela agrupada)

**Files:**
- Create: `apps/web/src/pages/app/Processes.tsx`

- [ ] **Criar `apps/web/src/pages/app/Processes.tsx`**

```tsx
import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import type { Board, Client } from '@/types'

const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']

function getProgress(board: Board): number {
  const all = board.columns.flatMap((c) => c.tasks)
  if (all.length === 0) return 0
  return Math.round((all.filter((t) => t.status === 'DONE').length / all.length) * 100)
}

function getMostUrgentDueDate(board: Board): Date | null {
  const dates = board.columns
    .flatMap((c) => c.tasks)
    .filter((t) => t.dueDate && t.status !== 'DONE' && t.status !== 'CANCELLED')
    .map((t) => new Date(t.dueDate!))
    .sort((a, b) => a.getTime() - b.getTime())
  return dates[0] ?? null
}

function getCurrentStage(board: Board): string {
  const counts = board.columns.map((col) => ({
    title: col.title,
    count: col.tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length,
  }))
  const active = counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  return active[0]?.title ?? 'Concluído'
}

function formatDueDate(date: Date | null, now: Date): { label: string; cls: string } {
  if (!date) return { label: '—', cls: 'text-gray-400' }
  const diff = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diff < 0) return { label: `Vencido há ${Math.abs(diff)}d`, cls: 'text-red-600 font-medium' }
  if (diff === 0) return { label: 'Vence hoje', cls: 'text-red-600 font-medium' }
  if (diff <= 7) return { label: `Em ${diff}d`, cls: 'text-amber-600 font-medium' }
  return { label: date.toLocaleDateString('pt-BR'), cls: 'text-gray-500' }
}

interface Group {
  label: string
  boards: Board[]
  headerCls: string
  defaultOpen: boolean
}

function BoardRow({ board, now }: { board: Board; now: Date }) {
  const progress = getProgress(board)
  const dueDate = getMostUrgentDueDate(board)
  const { label: dueDateLabel, cls: dueDateCls } = formatDueDate(dueDate, now)
  const stage = getCurrentStage(board)

  return (
    <Link
      to={`/app/board/${board.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
    >
      <div className="flex-[2] min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{board.title}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-600 truncate">{board.client.name}</p>
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate">{stage}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 truncate">{board.responsibleUser?.name ?? '—'}</p>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-gray-500 w-8 text-right">{progress}%</span>
      </div>
      <div className="w-24 text-right">
        <span className={cn('text-xs', dueDateCls)}>{dueDateLabel}</span>
      </div>
    </Link>
  )
}

function BoardGroup({ group, now }: { group: Group; now: Date }) {
  const [open, setOpen] = useState(group.defaultOpen)

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn('w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-left', group.headerCls)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {group.label}
        <span className="ml-1 font-normal opacity-70">({group.boards.length})</span>
      </button>

      {open && (
        <>
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex-[2] text-xs font-semibold text-gray-500 uppercase tracking-wide">Processo</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsável</div>
            <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progresso</div>
            <div className="w-24 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Prazo</div>
          </div>
          {group.boards.map((board) => (
            <BoardRow key={board.id} board={board} now={now} />
          ))}
        </>
      )}
    </div>
  )
}

export default function Processes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterResponsible, setFilterResponsible] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false)
  const [newProcessOpen, setNewProcessOpen] = useState(false)
  const [newProcessForm, setNewProcessForm] = useState({ title: '', clientId: '' })

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
    enabled: newProcessOpen,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/boards', { title: newProcessForm.title, clientId: newProcessForm.clientId }).then((r) => r.data),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ['boards'] })
      setNewProcessOpen(false)
      setNewProcessForm({ title: '', clientId: '' })
      navigate(`/app/board/${board.id}`)
    },
  })

  const now = useMemo(() => new Date(), [])
  const in7days = useMemo(() => new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), [now])

  // Unique clients and responsible users for filter dropdowns
  const uniqueClients = useMemo(
    () => [...new Map(boards.map((b) => [b.client.id, b.client])).values()],
    [boards],
  )
  const uniqueResponsible = useMemo(
    () => [
      ...new Map(
        boards
          .filter((b) => b.responsibleUser)
          .map((b) => [b.responsibleUser!.id, b.responsibleUser!]),
      ).values(),
    ],
    [boards],
  )
  const uniqueStages = useMemo(
    () => [...new Set(boards.flatMap((b) => b.columns.map((c) => c.title)))].sort(),
    [boards],
  )

  // Apply search and filter
  const filtered = useMemo(() => {
    return boards.filter((b) => {
      if (search) {
        const q = search.toLowerCase()
        if (!b.title.toLowerCase().includes(q) && !b.client.name.toLowerCase().includes(q)) return false
      }
      if (filterClient && b.client.id !== filterClient) return false
      if (filterResponsible && b.responsibleUser?.id !== filterResponsible) return false
      if (filterStage && !b.columns.some((c) => c.title.toLowerCase().includes(filterStage.toLowerCase()))) return false
      if (showOnlyOverdue) {
        const hasOverdue = b.columns.some((c) =>
          c.tasks.some((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'DONE' && t.status !== 'CANCELLED'),
        )
        if (!hasOverdue) return false
      }
      return true
    })
  }, [boards, search, filterClient, filterResponsible, filterStage, showOnlyOverdue, now])

  const hasActiveFilter = search || filterClient || filterResponsible || filterStage || showOnlyOverdue

  // Group boards by urgency
  const groups = useMemo((): Group[] => {
    if (hasActiveFilter) {
      // Flat list when filtering, sorted by urgency
      return [
        {
          label: 'Resultados',
          boards: [...filtered].sort((a, b) => {
            const da = getMostUrgentDueDate(a)
            const db = getMostUrgentDueDate(b)
            if (!da && !db) return 0
            if (!da) return 1
            if (!db) return -1
            return da.getTime() - db.getTime()
          }),
          headerCls: 'bg-gray-100 text-gray-700',
          defaultOpen: true,
        },
      ]
    }

    const overdue = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      return d && d < now
    })
    const dueSoon = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      return d && d >= now && d <= in7days
    })
    const inProgress = filtered.filter((b) => {
      const d = getMostUrgentDueDate(b)
      const p = getProgress(b)
      return p < 100 && (!d || d > in7days)
    })
    const completed = filtered.filter((b) => getProgress(b) === 100)

    return [
      { label: '⚠ Atrasados', boards: overdue, headerCls: 'bg-red-50 text-red-700', defaultOpen: true },
      { label: '⏰ Vence em 7 dias', boards: dueSoon, headerCls: 'bg-amber-50 text-amber-700', defaultOpen: true },
      { label: '📋 Em andamento', boards: inProgress, headerCls: 'bg-blue-50 text-blue-700', defaultOpen: true },
      { label: '✓ Concluídos', boards: completed, headerCls: 'bg-gray-100 text-gray-600', defaultOpen: false },
    ].filter((g) => g.boards.length > 0)
  }, [filtered, hasActiveFilter, now, in7days])

  if (isLoading) return <div className="p-8 text-gray-500">Carregando processos...</div>

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Processos</h1>
        {MANAGER_ROLES.includes(user?.role ?? '') && (
          <Button
            onClick={() => setNewProcessOpen(true)}
            className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2"
          >
            <Plus size={16} />
            Novo Processo
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Buscar processo ou cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60"
        />

        <select
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Cliente</option>
          {uniqueClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {MANAGER_ROLES.includes(user?.role ?? '') && (
          <select
            value={filterResponsible}
            onChange={(e) => setFilterResponsible(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Colaborador</option>
            {uniqueResponsible.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}

        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Etapa</option>
          {uniqueStages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <button
          type="button"
          onClick={() => setShowOnlyOverdue(!showOnlyOverdue)}
          className={cn(
            'h-9 px-3 rounded-md text-sm font-medium border transition-colors',
            showOnlyOverdue
              ? 'bg-red-500 text-white border-red-500'
              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
          )}
        >
          ⚠ Atrasados
        </button>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFilterClient(''); setFilterResponsible(''); setFilterStage(''); setShowOnlyOverdue(false) }}
            className="text-xs text-blue-600 hover:underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Grupos */}
      <div className="space-y-3">
        {groups.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg font-medium mb-2">Nenhum processo encontrado</p>
            <p className="text-sm">Ajuste os filtros ou crie um novo processo</p>
          </div>
        ) : (
          groups.map((group) => <BoardGroup key={group.label} group={group} now={now} />)
        )}
      </div>

      {/* Modal Novo Processo */}
      <Dialog open={newProcessOpen} onOpenChange={setNewProcessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Novo Processo</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (newProcessForm.title.trim() && newProcessForm.clientId) createMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="proc-title">Título do processo</Label>
              <Input
                id="proc-title"
                placeholder="Ex: Abertura de empresa LTDA"
                value={newProcessForm.title}
                onChange={(e) => setNewProcessForm({ ...newProcessForm, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-client">Cliente</Label>
              <select
                id="proc-client"
                value={newProcessForm.clientId}
                onChange={(e) => setNewProcessForm({ ...newProcessForm, clientId: e.target.value })}
                required
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Selecione um cliente</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">3 colunas padrão serão criadas automaticamente: Pendente → Em andamento → Concluído</p>
            {createMutation.isError && <p className="text-sm text-red-600">Erro ao criar processo. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setNewProcessOpen(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !newProcessForm.title.trim() || !newProcessForm.clientId}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {createMutation.isPending ? 'Criando...' : 'Criar processo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Verificar build completo**

```bash
pnpm --filter web build 2>&1 | grep -E "error|Error" | head -10
```

Esperado: zero erros.

- [ ] **Commit**

```bash
git add apps/web/src/pages/app/Processes.tsx
git commit -m "feat: página Processes com tabela agrupada por urgência e filtros"
```

---

## Checklist Final de Validação

- [ ] `GET /dashboard/metrics` retorna os 4 KPIs, tasksByStatus e atRisk
- [ ] `GET /boards?overdue=true` retorna apenas boards com tarefas vencidas
- [ ] `GET /boards?columnTitle=Pendente` retorna boards com essa etapa ativa
- [ ] Dashboard exibe os 4 cards coloridos com valores reais
- [ ] Gráfico de barras reflete a distribuição real de tarefas
- [ ] Painel "Em risco" mostra até 8 itens, clicáveis para o board
- [ ] Link "Ver todos os processos" navega para `/app/processes`
- [ ] Página Processos: grupo "Atrasados" aparece no topo em vermelho
- [ ] Filtros de cliente, colaborador e etapa funcionam
- [ ] Toggle "⚠ Atrasados" filtra corretamente
- [ ] Limpar filtros restaura o agrupamento padrão
- [ ] ORG_MEMBER NÃO vê o filtro "Colaborador"
- [ ] Sidebar tem link "Processos" ativo com highlight correto
- [ ] Botão "Novo Processo" cria e redireciona para o board
- [ ] `pnpm --filter api test` — todos os 137+ testes passando
