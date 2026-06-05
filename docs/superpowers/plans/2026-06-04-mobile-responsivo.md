# Mobile Responsivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar as páginas internas do painel (`/app/*`) totalmente utilizáveis em dispositivos móveis (≥ 320px).

**Architecture:** Nenhuma biblioteca nova. Usar breakpoints Tailwind (`md:` = ≥ 768px) para alternar entre layout mobile e desktop. Sidebar vira drawer com overlay no mobile. Tabela de Processos vira cards no mobile. Kanban mantém drag-and-drop com scroll horizontal nativo. TaskDrawer já é responsivo (`w-full max-w-[560px]`), só precisa ajuste de altura.

**Tech Stack:** React 19, TailwindCSS v4, lucide-react (ícone `Menu`), `useState` para controle do drawer.

---

## Mapa de Arquivos

| Arquivo | O que muda |
|---|---|
| `apps/web/src/components/AppLayout.tsx` | Sidebar vira drawer no mobile; adiciona mobile top-bar com hambúrguer |
| `apps/web/src/pages/app/DashboardMetrics.tsx` | Ajuste de padding e gráfico de barras no mobile |
| `apps/web/src/pages/app/Processes.tsx` | Filtros com wrap; `BoardRow` vira card no mobile; ocultar cabeçalho da tabela |
| `apps/web/src/pages/app/Board.tsx` | Header compacto; search bar empilhável; colunas com `min-w` para scroll horizontal |

---

## Task 1: AppLayout — Sidebar hambúrguer + mobile top-bar

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Substituir o conteúdo de `AppLayout.tsx` pelo seguinte:**

```tsx
import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on navigation (mobile)
  const handleNavClick = () => setSidebarOpen(false)

  async function handleLogout() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try { await api.post('/auth/logout', { refreshToken }) } catch { /* ignore */ }
    }
    logout()
    navigate('/login')
  }

  const role = user?.role ?? ''

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 flex flex-col',
          'transition-transform duration-200',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-blue-600">Tramita</h1>
            <p className="text-xs text-gray-500 truncate">{user?.name}</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/processes" icon={<ClipboardList size={16} />} label="Processos" onClick={handleNavClick} />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" onClick={handleNavClick} />
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top-bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-gray-500 hover:text-gray-700"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-base font-bold text-blue-600">Tramita</h1>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarLink({
  to,
  icon,
  label,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
```

- [ ] **Verificar build**

```bash
pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add apps/web/src/components/AppLayout.tsx
git commit -m "feat(mobile): sidebar hambúrguer com overlay e top-bar mobile"
```

---

## Task 2: DashboardMetrics — padding e gráfico responsivos

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

- [ ] **Ajustar padding do container principal e label do gráfico**

Substituir linha `<div className="p-6 space-y-6">`:
```tsx
<div className="p-4 md:p-6 space-y-4 md:space-y-6">
```

Substituir linha `<h1 className="text-xl font-bold text-gray-900">Dashboard</h1>`:
```tsx
<h1 className="text-lg md:text-xl font-bold text-gray-900">Dashboard</h1>
```

O grid de KPIs (`grid-cols-2 lg:grid-cols-4`) e o grid do gráfico (`grid-cols-1 lg:grid-cols-3`) já são responsivos — não precisam de mudança.

- [ ] **No gráfico de barras, reduzir gap no mobile para não cortar os labels**

Substituir `<div className="flex items-end gap-6 h-40">`:
```tsx
<div className="flex items-end gap-2 md:gap-6 h-40">
```

- [ ] **Verificar build e commit**

```bash
pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(mobile): dashboard com padding e gráfico responsivos"
```

---

## Task 3: Processes — filtros wrap + tabela vira cards no mobile

**Files:**
- Modify: `apps/web/src/pages/app/Processes.tsx`

- [ ] **Substituir a função `BoardRow` inteira pelo layout responsivo**

A lógica de `getProgress`, `getMostUrgentDueDate`, `getCurrentStage` e `formatDueDate` ficam inalteradas. Só o JSX de `BoardRow` e `BoardGroup` muda.

Substituir a função `BoardRow` por:

```tsx
function BoardRow({ board, now }: { board: Board; now: Date }) {
  const progress = getProgress(board)
  const taskDueDate = getMostUrgentDueDate(board)
  const effectiveDueDate = taskDueDate ?? (board.dueDate ? new Date(board.dueDate) : null)
  const { label: dueDateLabel, cls: dueDateCls } = formatDueDate(effectiveDueDate, now)
  const stage = getCurrentStage(board)

  return (
    <Link
      to={`/app/board/${board.id}`}
      className="block px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
    >
      {/* Mobile: card layout */}
      <div className="md:hidden">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-gray-900 flex-1 min-w-0 truncate">{board.title}</p>
          <span className={cn('text-xs flex-shrink-0', dueDateCls)}>{dueDateLabel}</span>
        </div>
        <p className="text-xs text-gray-500 mb-2">{board.client.name}</p>
        <div className="flex items-center gap-3">
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{stage}</span>
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Desktop: table row */}
      <div className="hidden md:flex items-center gap-3">
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
      </div>
    </Link>
  )
}
```

- [ ] **Ocultar cabeçalho da tabela no mobile dentro de `BoardGroup`**

Dentro de `BoardGroup`, substituir:
```tsx
<div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
  <div className="flex-[2] text-xs font-semibold text-gray-500 uppercase tracking-wide">Processo</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsável</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progresso</div>
  <div className="w-24 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Prazo</div>
</div>
```

Por:
```tsx
<div className="hidden md:flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
  <div className="flex-[2] text-xs font-semibold text-gray-500 uppercase tracking-wide">Processo</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Etapa</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsável</div>
  <div className="flex-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progresso</div>
  <div className="w-24 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Prazo</div>
</div>
```

- [ ] **Ajustar barra de filtros para wrap no mobile**

Na seção de filtros, substituir:
```tsx
<div className="flex flex-wrap gap-2 items-center">
  <Input
    placeholder="Buscar processo ou cliente..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="w-60"
  />
```

Por:
```tsx
<div className="flex flex-wrap gap-2 items-center">
  <Input
    placeholder="Buscar processo ou cliente..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="w-full sm:w-60"
  />
```

- [ ] **Ajustar padding e botão "Novo Processo" no mobile**

Substituir:
```tsx
<div className="p-6 space-y-4">
  <div className="flex items-center justify-between">
    <h1 className="text-xl font-bold text-gray-900">Processos</h1>
```

Por:
```tsx
<div className="p-4 md:p-6 space-y-4">
  <div className="flex items-center justify-between">
    <h1 className="text-lg md:text-xl font-bold text-gray-900">Processos</h1>
```

- [ ] **Verificar build e commit**

```bash
pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
git add apps/web/src/pages/app/Processes.tsx
git commit -m "feat(mobile): página Processos com cards e filtros responsivos"
```

---

## Task 4: Board — kanban responsivo com scroll horizontal

**Files:**
- Modify: `apps/web/src/pages/app/Board.tsx`

- [ ] **Header do board: compactar no mobile e ocultar prazo badge quando necessário**

Substituir o bloco do header (a `<div>` com `flex items-center gap-3 px-6 py-4 ...`):

```tsx
<div className="flex items-center gap-2 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 bg-white flex-shrink-0">
  <Link to="/app/processes" className="text-gray-400 hover:text-gray-600 flex-shrink-0">
    <ArrowLeft size={18} />
  </Link>
  <div className="flex-1 min-w-0">
    <h1 className="text-base md:text-lg font-semibold text-gray-900 truncate">{board.title}</h1>
    <p className="text-xs md:text-sm text-gray-500 truncate">{board.client.name}</p>
  </div>
  {boardDueDate && (
    <span className={cn(
      'text-xs px-2 py-1 rounded-full font-medium flex-shrink-0',
      boardDueDateOverdue
        ? 'bg-red-100 text-red-700'
        : 'bg-amber-50 text-amber-700'
    )}>
      {boardDueDateOverdue ? '⚠ ' : ''}{boardDueDate.toLocaleDateString('pt-BR')}
    </span>
  )}
</div>
```

- [ ] **Search bar: empilhar no mobile**

Substituir:
```tsx
<div className="flex items-center gap-3 px-6 py-2 border-b border-gray-100 bg-white">
  <input
    type="text"
    placeholder="Buscar tarefas..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="flex-1 h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
  <select
    value={filterPriority}
    onChange={(e) => setFilterPriority(e.target.value)}
    className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
```

Por:
```tsx
<div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-2 border-b border-gray-100 bg-white">
  <input
    type="text"
    placeholder="Buscar tarefas..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="flex-1 min-w-0 h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
  <select
    value={filterPriority}
    onChange={(e) => setFilterPriority(e.target.value)}
    className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
```

- [ ] **Kanban: ajustar padding e largura mínima das colunas para scroll horizontal funcionar**

Substituir:
```tsx
<div className="flex-1 overflow-x-auto p-6">
  <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="flex gap-4 h-full">
      {board.columns.map((column) => (
        <div key={column.id} className="flex-shrink-0 w-64">
```

Por:
```tsx
<div className="flex-1 overflow-x-auto p-4 md:p-6">
  <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="flex gap-3 md:gap-4 h-full">
      {board.columns.map((column) => (
        <div key={column.id} className="flex-shrink-0 w-[280px] md:w-64">
```

> **Nota:** `w-[280px]` no mobile dá uma margem lateral de ~20px em telas de 320px, deixando claro que existem mais colunas para scrollar.

- [ ] **Verificar build e commit**

```bash
pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
git add apps/web/src/pages/app/Board.tsx
git commit -m "feat(mobile): board kanban com scroll horizontal e header responsivo"
```

---

## Checklist Final de Validação

- [ ] Em 375px (iPhone SE): sidebar abre/fecha pelo hambúrguer
- [ ] Navegar para outra tela fecha o sidebar automaticamente
- [ ] Dashboard mostra 2 KPIs por linha no mobile, 4 no desktop
- [ ] Página Processos mostra cards empilhados no mobile
- [ ] Filtros de Processos quebram em múltiplas linhas no mobile
- [ ] Board kanban tem scroll horizontal no mobile (≥ 2 colunas visíveis)
- [ ] TaskDrawer ocupa tela inteira no mobile
- [ ] `pnpm --filter web build` sem erros
