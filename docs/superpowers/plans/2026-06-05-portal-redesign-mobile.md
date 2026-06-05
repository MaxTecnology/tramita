# Portal do Cliente — Redesign Visual + Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar visualmente o portal do cliente com responsividade mobile completa — bottom tab bar no mobile, cards melhorados, prioridades em PT-BR e remoção de componentes Card/CardContent.

**Architecture:** Reescritas completas de 5 arquivos frontend. Nenhuma mudança de backend, lógica ou API. Layout usa `hidden md:flex` para sidebar + `fixed bottom-0 md:hidden` para bottom tab bar. Breakpoint mobile: `md` (768px).

**Tech Stack:** React 19, TailwindCSS v4, shadcn/ui (`Button`, `Input`, `Label`), Lucide React (ícones já instalados), Sonner (toast já instalado)

---

## Mapa de Arquivos

| Task | Arquivo | Mudança principal |
|---|---|---|
| 1 | `apps/web/src/pages/portal/Layout.tsx` | Sidebar desktop-only + bottom tab bar mobile |
| 2 | `apps/web/src/pages/portal/Boards.tsx` | Cards melhorados + empty state + grid responsivo |
| 3 | `apps/web/src/pages/portal/Board.tsx` | Prioridades PT-BR + search icon + progresso dinâmico |
| 4 | `apps/web/src/pages/portal/Profile.tsx` | Remove Card + avatar + botão à direita |
| 4 | `apps/web/src/pages/portal/Reports.tsx` | Remove Card + toast.error + Download icon |

---

## Task 1: Layout.tsx — Sidebar desktop + Bottom tab bar mobile

**Files:**
- Modify: `apps/web/src/pages/portal/Layout.tsx`

- [ ] **Substituir o conteúdo completo de `apps/web/src/pages/portal/Layout.tsx` por:**

```tsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutGrid, FileText, User, LogOut } from 'lucide-react'

const tabs = [
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos' },
  { to: '/portal/reports', icon: FileText, label: 'Relatórios' },
  { to: '/portal/profile', icon: User, label: 'Perfil' },
] as const

export default function PortalLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try { await api.post('/auth/logout', { refreshToken }) } catch { /* ignore */ }
    }
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-52 bg-white border-r border-gray-200 flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-[#185FA5]">Tramita</h1>
          <p className="text-xs text-gray-500 truncate mt-0.5">{user?.name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {tabs.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-blue-50 text-[#185FA5] font-medium' : 'text-gray-600 hover:bg-gray-100',
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content — pb-16 evita conteúdo atrás da tab bar no mobile */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Bottom tab bar — mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-200 flex h-16">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors',
                isActive ? 'text-[#185FA5]' : 'text-gray-400',
              )
            }
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/pages/portal/Layout.tsx
git commit -m "feat(portal): sidebar desktop-only e bottom tab bar no mobile"
```

---

## Task 2: Boards.tsx — Cards melhorados + empty state + grid responsivo

**Files:**
- Modify: `apps/web/src/pages/portal/Boards.tsx`

- [ ] **Substituir o conteúdo completo de `apps/web/src/pages/portal/Boards.tsx` por:**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { ClipboardList, ArrowRight } from 'lucide-react'

interface BoardSummary {
  id: string
  title: string
  client: { id: string; name: string }
}

export default function PortalBoards() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['portal-boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Meus Processos</h1>
        <p className="text-sm text-gray-500 mt-1">Acompanhe o andamento dos seus processos.</p>
      </div>

      {boards.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-base font-medium text-gray-500 mb-1">Nenhum processo encontrado.</p>
          <p className="text-sm text-gray-400">Seu escritório ainda não criou processos para você.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Link
              key={board.id}
              to={`/portal/board/${board.id}`}
              className="group block bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 truncate group-hover:text-[#185FA5] transition-colors">
                  {board.title}
                </h2>
                <ArrowRight size={16} className="text-gray-300 group-hover:text-[#185FA5] transition-colors flex-shrink-0 mt-0.5" />
              </div>
              <p className="text-xs text-gray-400 mt-3">Toque para ver detalhes</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/pages/portal/Boards.tsx
git commit -m "feat(portal): cards de processos com hover, empty state e grid responsivo"
```

---

## Task 3: Board.tsx — Prioridades PT-BR + search icon + progresso dinâmico

**Files:**
- Modify: `apps/web/src/pages/portal/Board.tsx`

- [ ] **Substituir o conteúdo completo de `apps/web/src/pages/portal/Board.tsx` por:**

```tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ArrowLeft, Search } from 'lucide-react'
import { useBoardStream } from '@/hooks/useBoardStream'
import { TaskDrawer } from '@/components/portal/TaskDrawer'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import type { Board, Task } from '@/types'

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', URGENT: 'Urgente',
}

const PRIORITY_CLS: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

export default function PortalBoard() {
  const { boardId } = useParams<{ boardId: string }>()
  useBoardStream(boardId)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [titleSearch, setTitleSearch] = useState('')
  const { user } = useAuth()

  const { data: board, isLoading } = useQuery<Board>({
    queryKey: ['portal-board', boardId],
    queryFn: () => api.get(`/boards/${boardId}`).then((r) => r.data),
    enabled: !!boardId,
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>
  if (!board) return <div className="p-8 text-gray-500">Processo não encontrado.</div>

  const allTasks = board.columns.flatMap((c) => c.tasks)
  const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0
  const progressCls = progress >= 80 ? 'bg-green-500' : 'bg-blue-500'

  const filteredColumns = board.columns.map((col) => ({
    ...col,
    tasks: titleSearch.trim()
      ? col.tasks.filter((t) => t.title.toLowerCase().includes(titleSearch.toLowerCase()))
      : col.tasks,
  }))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 bg-white">
        <Link to="/portal/board" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base md:text-lg font-semibold text-gray-900 truncate">{board.title}</h1>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', progressCls)}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 flex-shrink-0">{progress}% concluído</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 md:px-6 py-2 border-b border-gray-100 bg-white">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por título..."
            value={titleSearch}
            onChange={(e) => setTitleSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-md border border-gray-200 bg-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#185FA5]"
          />
        </div>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <div className="flex gap-4 h-full min-w-max">
          {filteredColumns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-64 md:w-72">
              <div
                className="flex items-center justify-between mb-3 pb-2 border-b-2"
                style={{ borderBottomColor: column.color ?? '#e5e7eb' }}
              >
                <h3 className="text-sm font-semibold text-gray-700">{column.title}</h3>
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                  {column.tasks.length}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {column.tasks.map((task) => {
                  const isOverdue =
                    task.dueDate !== null &&
                    task.status !== 'DONE' &&
                    new Date(task.dueDate) < new Date()

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={cn(
                        'bg-white rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow',
                        isOverdue ? 'border-red-400' : 'border-gray-200',
                      )}
                    >
                      <p className="text-sm font-medium text-gray-800 line-clamp-2">{task.title}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_CLS[task.priority] ?? 'bg-gray-100 text-gray-600')}>
                          {PRIORITY_LABEL[task.priority] ?? task.priority}
                        </span>
                        {task.dueDate && (
                          <span className={cn('text-xs', isOverdue ? 'text-red-500 font-medium' : 'text-gray-400')}>
                            {isOverdue ? '⚠ ' : ''}{new Date(task.dueDate).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          currentUserId={user?.id ?? ''}
          role="CLIENT"
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/pages/portal/Board.tsx
git commit -m "feat(portal): prioridades PT-BR, search com ícone e progresso dinâmico no board"
```

---

## Task 4: Profile.tsx + Reports.tsx — Remove Card, avatar, toast e botões da marca

**Files:**
- Modify: `apps/web/src/pages/portal/Profile.tsx`
- Modify: `apps/web/src/pages/portal/Reports.tsx`

- [ ] **Substituir o conteúdo completo de `apps/web/src/pages/portal/Profile.tsx` por:**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

function Avatar({ name }: { name: string }) {
  const initials = (name ?? '?').split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'
  return (
    <div className="h-12 w-12 rounded-full bg-[#185FA5] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
      {initials}
    </div>
  )
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
    setErrorMsg('')
    if (form.password && form.password !== form.confirmPassword) {
      setErrorMsg('As senhas não coincidem.')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Meu Perfil</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Avatar header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60 flex items-center gap-3">
          <Avatar name={user?.name ?? ''} />
          <div>
            <p className="text-sm font-semibold text-gray-800">{user?.name}</p>
            <p className="text-xs text-gray-400">Cliente</p>
          </div>
        </div>

        {/* Form */}
        <div className="px-5 py-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="p-whatsapp">WhatsApp</Label>
            <Input
              id="p-whatsapp"
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="5582999999999"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-password">Nova senha</Label>
            <Input
              id="p-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Deixe em branco para não alterar"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="p-confirm">Confirmar nova senha</Label>
            <Input
              id="p-confirm"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>

          {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
            >
              {mutation.isPending ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Substituir o conteúdo completo de `apps/web/src/pages/portal/Reports.tsx` por:**

```tsx
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const selectCls = 'h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#185FA5]'

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
      <div className="mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Relatórios</h1>
        <p className="text-sm text-gray-500 mt-1">Baixe o relatório mensal dos seus processos.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Relatório mensal</p>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium text-gray-700">Mês</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={cn(selectCls, 'w-full')}
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Ano</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className={cn(selectCls, 'w-24')}
              >
                {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              onClick={handleDownload}
              disabled={loading}
              className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2"
            >
              <Download size={16} />
              {loading ? 'Gerando...' : 'Baixar PDF'}
            </Button>
          </div>

          <p className="text-xs text-gray-400">
            O relatório inclui todas as tarefas movimentadas no período selecionado.
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/pages/portal/Profile.tsx apps/web/src/pages/portal/Reports.tsx
git commit -m "feat(portal): redesign Profile e Reports — remove Card, avatar, toast e botões da marca"
```

---

## Checklist Final de Validação

- [ ] Desktop: sidebar exibida normalmente com logo `#185FA5` e links ativos em azul da marca
- [ ] Mobile: sidebar oculta, bottom tab bar fixa com 3 tabs (Processos / Relatórios / Perfil)
- [ ] Tab ativa no mobile: ícone + label em `#185FA5`
- [ ] Conteúdo não fica atrás da tab bar no mobile (`pb-16`)
- [ ] Cards de processos com `rounded-xl shadow-sm hover:shadow-md` e seta `→`
- [ ] Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- [ ] Empty state com ícone `ClipboardList`
- [ ] Prioridades no kanban em PT-BR (Baixa / Média / Alta / Urgente)
- [ ] Busca no board com ícone `Search` integrado
- [ ] Barra de progresso verde quando ≥ 80%
- [ ] Profile com avatar de iniciais e botão salvar à direita
- [ ] Reports com `toast.error()` e botão `Download` da marca
- [ ] Build sem erros TypeScript
