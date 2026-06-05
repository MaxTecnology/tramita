# Portal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o portal do cliente (`/portal/*`) com visual mais polido, informações mais ricas nos cards de processos, prioridades em PT-BR, e nome do escritório visível na sidebar.

**Architecture:** Mudança mínima no backend (`auth.service.ts` + `auth.types.ts`) para incluir `orgName` na sessão. Todas as outras mudanças são frontend-only. `Boards.tsx` aproveita dados já retornados pela API (columns + tasks) para mostrar progresso e etapa atual. Nenhuma nova biblioteca.

**Tech Stack:** React 19, TailwindCSS v4, TanStack Query, lucide-react, sonner (toast), TypeScript strict.

---

## Mapa de Arquivos

| Arquivo | O que muda |
|---|---|
| `apps/api/src/modules/auth/auth.types.ts` | Adiciona `orgName` em `AuthUser` |
| `apps/api/src/modules/auth/auth.service.ts` | Inclui `orgName` no `buildSession` e na resposta |
| `apps/web/src/hooks/useAuth.ts` | Adiciona `orgName` em `StoredUser` |
| `apps/web/src/pages/portal/Layout.tsx` | Exibe `orgName` abaixo do nome do usuário |
| `apps/web/src/pages/portal/Boards.tsx` | Cards ricos com progresso, etapa atual, empty state com ícone |
| `apps/web/src/pages/portal/Board.tsx` | Prioridades PT-BR, busca com ícone, mobile scroll, progress bar verde ≥80% |
| `apps/web/src/pages/portal/Profile.tsx` | Remove Card/CardContent, avatar com iniciais, botão com cor da marca |
| `apps/web/src/pages/portal/Reports.tsx` | Remove Card/CardContent, `alert` → `toast.error`, selects e botão estilizados |

---

## Task 1: auth — orgName na sessão

**Files:**
- Modify: `apps/api/src/modules/auth/auth.types.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`

- [ ] **Adicionar `orgName` em `AuthUser`**

Em `apps/api/src/modules/auth/auth.types.ts`, substituir:
```ts
export interface AuthUser {
  id: string
  name: string
  role: Role
  organizationId: string | null
}
```
Por:
```ts
export interface AuthUser {
  id: string
  name: string
  role: Role
  organizationId: string | null
  orgName: string | null
}
```

- [ ] **Incluir `orgName` no `buildSession`**

Em `apps/api/src/modules/auth/auth.service.ts`, substituir a função `buildSession` e os dois call sites:

Substituir:
```ts
export async function login(email: string, password: string): Promise<LoginResponse> {
  // Try User table first
  const user = await prisma.user.findUnique({ where: { email } })
  if (user && (await verifyPassword(password, user.passwordHash))) {
    return buildSession(user.id, user.name, user.role as Role, user.organizationId)
  }

  // Fall back to Client table
  const client = await prisma.client.findFirst({ where: { email } })
  if (client && (await verifyPassword(password, client.passwordHash))) {
    return buildSession(client.id, client.name, 'CLIENT', client.organizationId)
  }

  throw new AppError(401, 'Credenciais inválidas')
}

async function buildSession(
  id: string,
  name: string,
  role: Role,
  organizationId: string,
): Promise<LoginResponse> {
  const accessToken = generateAccessToken({ sub: id, role, organizationId })
  const refreshToken = uuidv4()

  await redis.set(
    `refresh:${refreshToken}`,
    JSON.stringify({ sub: id, role, organizationId }),
    'EX',
    REFRESH_TTL_SECONDS,
  )

  return { accessToken, refreshToken, user: { id, name, role, organizationId } }
}
```

Por:
```ts
export async function login(email: string, password: string): Promise<LoginResponse> {
  // Try User table first
  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: { select: { name: true } } },
  })
  if (user && (await verifyPassword(password, user.passwordHash))) {
    return buildSession(user.id, user.name, user.role as Role, user.organizationId, user.organization?.name ?? null)
  }

  // Fall back to Client table
  const client = await prisma.client.findFirst({
    where: { email },
    include: { organization: { select: { name: true } } },
  })
  if (client && (await verifyPassword(password, client.passwordHash))) {
    return buildSession(client.id, client.name, 'CLIENT', client.organizationId, client.organization?.name ?? null)
  }

  throw new AppError(401, 'Credenciais inválidas')
}

async function buildSession(
  id: string,
  name: string,
  role: Role,
  organizationId: string | null,
  orgName: string | null,
): Promise<LoginResponse> {
  const accessToken = generateAccessToken({ sub: id, role, organizationId })
  const refreshToken = uuidv4()

  await redis.set(
    `refresh:${refreshToken}`,
    JSON.stringify({ sub: id, role, organizationId }),
    'EX',
    REFRESH_TTL_SECONDS,
  )

  return { accessToken, refreshToken, user: { id, name, role, organizationId, orgName } }
}
```

- [ ] **Verificar build do backend**

```bash
npx pnpm --filter api build 2>&1 | tail -5
```

Esperado: sem erros TypeScript. Se aparecer erro de tipo em `user.organization` — verificar se o Prisma schema tem `organization Organization?` na model `User`. Se sim, o `include` funciona.

- [ ] **Commit**

```bash
git add apps/api/src/modules/auth/auth.types.ts apps/api/src/modules/auth/auth.service.ts
git commit -m "feat(auth): incluir orgName na sessão de login"
```

---

## Task 2: useAuth — expor orgName no frontend

**Files:**
- Modify: `apps/web/src/hooks/useAuth.ts`

- [ ] **Adicionar `orgName` em `StoredUser`**

Substituir o conteúdo de `apps/web/src/hooks/useAuth.ts`:

```ts
import { useMemo } from 'react'

interface StoredUser {
  id: string
  name: string
  role: string
  organizationId: string | null
  orgName: string | null
}

export function useAuth() {
  const user = useMemo<StoredUser | null>(() => {
    try {
      const raw = localStorage.getItem('user')
      return raw ? (JSON.parse(raw) as StoredUser) : null
    } catch {
      return null
    }
  }, [])

  const isAuthenticated = !!localStorage.getItem('accessToken')

  function logout() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
  }

  return { user, isAuthenticated, logout }
}
```

- [ ] **Verificar build do frontend**

```bash
npx pnpm --filter web build 2>&1 | tail -3
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/hooks/useAuth.ts
git commit -m "feat(portal): expor orgName no hook useAuth"
```

---

## Task 3: Layout — exibir nome do escritório

**Files:**
- Modify: `apps/web/src/pages/portal/Layout.tsx`

- [ ] **Exibir `orgName` na sidebar desktop**

No bloco da sidebar desktop, substituir:
```tsx
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-[#185FA5]">Tramita</h1>
          <p className="text-xs text-gray-500 truncate mt-0.5">{user?.name}</p>
        </div>
```

Por:
```tsx
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-[#185FA5]">Tramita</h1>
          <p className="text-xs text-gray-800 font-medium truncate mt-0.5">{user?.orgName}</p>
          <p className="text-xs text-gray-500 truncate">{user?.name}</p>
        </div>
```

- [ ] **Verificar build e commit**

```bash
npx pnpm --filter web build 2>&1 | tail -3
git add apps/web/src/pages/portal/Layout.tsx
git commit -m "feat(portal): exibir nome do escritório na sidebar"
```

---

## Task 4: Boards — cards ricos com progresso e etapa atual

**Files:**
- Modify: `apps/web/src/pages/portal/Boards.tsx`

O endpoint `/boards` (portal) já retorna `columns` com `tasks` incluso. O `BoardSummary` atual está incompleto — precisa ser expandido.

- [ ] **Substituir o conteúdo de `Boards.tsx` pelo seguinte:**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { ClipboardList, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  status: string
}

interface Column {
  id: string
  title: string
  tasks: Task[]
}

interface BoardSummary {
  id: string
  title: string
  client: { id: string; name: string }
  dueDate: string | null
  columns: Column[]
}

function getProgress(board: BoardSummary): number {
  const all = board.columns.flatMap((c) => c.tasks)
  if (all.length === 0) return 0
  const done = all.filter((t) => t.status === 'DONE').length
  return Math.round((done / all.length) * 100)
}

function getCurrentStage(board: BoardSummary): string {
  const active = board.columns.find((c) => c.tasks.some((t) => t.status !== 'DONE'))
  return active?.title ?? board.columns.at(-1)?.title ?? '—'
}

export default function PortalBoards() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['portal-boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-6 text-gray-500 text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-gray-900">Meus Processos</h1>

      {boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <ClipboardList size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum processo encontrado</p>
          <p className="text-xs mt-1">Seu escritório ainda não abriu processos para você.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {boards.map((board) => {
            const progress = getProgress(board)
            const stage = getCurrentStage(board)
            const isOverdue = board.dueDate ? new Date(board.dueDate) < new Date() : false

            return (
              <Link
                key={board.id}
                to={`/portal/board/${board.id}`}
                className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-gray-900 leading-snug flex-1 min-w-0">{board.title}</h2>
                  <ArrowRight size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full truncate">{stage}</span>
                  {board.dueDate && (
                    <span className={cn('text-xs ml-auto flex-shrink-0', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                      {isOverdue ? '⚠ ' : ''}{new Date(board.dueDate).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', progress >= 80 ? 'bg-green-500' : 'bg-[#185FA5]')}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right flex-shrink-0">{progress}%</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Verificar build e commit**

```bash
npx pnpm --filter web build 2>&1 | tail -3
git add apps/web/src/pages/portal/Boards.tsx
git commit -m "feat(portal): cards de processos com progresso, etapa e prazo"
```

---

## Task 5: Board — prioridades PT-BR, ícone na busca, mobile scroll, progress bar dinâmica

**Files:**
- Modify: `apps/web/src/pages/portal/Board.tsx`

- [ ] **Adicionar mapa de prioridades PT-BR e ícone Search**

Logo após os imports existentes, adicionar a importação de `Search`:
```tsx
import { ArrowLeft, Search } from 'lucide-react'
```

Depois das declarações de `useState`/`useQuery`, adicionar a constante:
```tsx
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}
```

- [ ] **Adicionar ícone de lupa na busca**

Substituir o bloco da busca:
```tsx
      {/* Title search */}
      <div className="px-6 py-2 border-b border-gray-100 bg-white">
        <input
          type="text"
          placeholder="Buscar por título..."
          value={titleSearch}
          onChange={(e) => setTitleSearch(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
```

Por:
```tsx
      {/* Title search */}
      <div className="px-4 md:px-6 py-2 border-b border-gray-100 bg-white">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por título..."
            value={titleSearch}
            onChange={(e) => setTitleSearch(e.target.value)}
            className="w-full h-8 rounded-md border border-gray-300 bg-white pl-8 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          />
        </div>
      </div>
```

- [ ] **Ajustar kanban para mobile scroll e progress bar dinâmica**

Substituir:
```tsx
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full">
          {filteredColumns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-64">
```

Por:
```tsx
      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <div className="flex gap-3 md:gap-4 h-full">
          {filteredColumns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-[280px] md:w-64">
```

- [ ] **Traduzir prioridades para PT-BR**

Substituir dentro do card de tarefa:
```tsx
                        {task.priority}
```

Por:
```tsx
                        {PRIORITY_LABELS[task.priority] ?? task.priority}
```

- [ ] **Progress bar da barra de progresso: verde ≥80%**

Substituir:
```tsx
              className="h-full bg-blue-500 rounded-full transition-all"
```

Por:
```tsx
              className={cn('h-full rounded-full transition-all', progress >= 80 ? 'bg-green-500' : 'bg-[#185FA5]')}
```

- [ ] **Verificar build e commit**

```bash
npx pnpm --filter web build 2>&1 | tail -3
git add apps/web/src/pages/portal/Board.tsx
git commit -m "feat(portal): prioridades PT-BR, busca com ícone, kanban mobile responsivo"
```

---

## Task 6: Profile — avatar com iniciais, sem Card, botão da marca

**Files:**
- Modify: `apps/web/src/pages/portal/Profile.tsx`

- [ ] **Substituir o conteúdo de `Profile.tsx` pelo seguinte:**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export default function PortalProfile() {
  const { user } = useAuth()
  const [form, setForm] = useState({ password: '', confirmPassword: '', whatsapp: '' })
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const payload: { password?: string; whatsapp?: string } = {}
      if (form.whatsapp) payload.whatsapp = form.whatsapp
      if (form.password) payload.password = form.password
      return api.patch('/portal/profile', payload).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success('Perfil atualizado')
      setForm({ password: '', confirmPassword: '', whatsapp: '' })
    },
    onError: () => {
      toast.error('Erro ao atualizar perfil')
    },
  })

  function handleSave() {
    if (form.password && form.password !== form.confirmPassword) {
      setErrorMsg('As senhas não coincidem.')
      return
    }
    setErrorMsg('')
    mutation.mutate()
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h1 className="text-lg md:text-xl font-bold text-gray-900 mb-6">Meu Perfil</h1>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-5">
        {/* Avatar + nome */}
        <div className="flex items-center gap-4">
          <div
            className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-base"
            style={{ backgroundColor: '#185FA5' }}
          >
            {user?.name ? getInitials(user.name) : '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            {user?.orgName && <p className="text-xs text-gray-500 truncate">{user.orgName}</p>}
          </div>
        </div>

        <hr className="border-gray-100" />

        <div>
          <Label>WhatsApp</Label>
          <Input
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="5582999999999"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Nova senha</Label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Deixe em branco para não alterar"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Confirmar nova senha</Label>
          <Input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            className="mt-1"
          />
        </div>

        {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="bg-[#185FA5] hover:bg-[#145088] text-white"
          >
            Salvar alterações
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Verificar build e commit**

```bash
npx pnpm --filter web build 2>&1 | tail -3
git add apps/web/src/pages/portal/Profile.tsx
git commit -m "feat(portal): perfil com avatar de iniciais e visual sem Card"
```

---

## Task 7: Reports — sem Card, toast, selects e botão estilizados

**Files:**
- Modify: `apps/web/src/pages/portal/Reports.tsx`

- [ ] **Substituir o conteúdo de `Reports.tsx` pelo seguinte:**

```tsx
import { useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const SELECT_CLS = 'mt-1 flex h-9 w-full rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#185FA5]'

export default function PortalReports() {
  const { user } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const monthStr = `${year}-${String(month).padStart(2, '0')}`
      const res = await api.get(`/clients/${user?.id}/report?month=${monthStr}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${monthStr}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Relatório não disponível para este período.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <h1 className="text-lg md:text-xl font-bold text-gray-900 mb-6">Relatórios</h1>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-5">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1">Download de relatório mensal</p>
          <p className="text-xs text-gray-400">Inclui todas as tarefas movimentadas no período selecionado.</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-600">Mês</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={SELECT_CLS}>
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label className="text-xs font-medium text-gray-600">Ano</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={SELECT_CLS}>
              {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-[#185FA5] hover:bg-[#145088] text-white text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          <Download size={15} />
          {loading ? 'Gerando...' : 'Baixar PDF'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Verificar build e commit**

```bash
npx pnpm --filter web build 2>&1 | tail -3
git add apps/web/src/pages/portal/Reports.tsx
git commit -m "feat(portal): relatórios sem Card, toast de erro, visual com cor da marca"
```

---

## Checklist Final de Validação

- [ ] Login de cliente retorna `orgName` na resposta
- [ ] Sidebar do portal exibe nome do escritório abaixo do usuário
- [ ] Cards de processos mostram barra de progresso, etapa atual e prazo
- [ ] Prioridades nas tasks do board exibem Baixa / Média / Alta / Urgente
- [ ] Campo de busca no board tem ícone de lupa
- [ ] Kanban tem scroll horizontal no mobile (colunas 280px)
- [ ] Perfil exibe avatar com iniciais em #185FA5
- [ ] Relatórios: erro mostra toast.error em vez de alert()
- [ ] `npx pnpm --filter web build` sem erros
- [ ] `npx pnpm --filter api build` sem erros
