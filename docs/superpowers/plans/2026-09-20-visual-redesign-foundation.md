# Redesign Visual Premium — Fundação + Telas Principais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir as cores hardcoded (`#185FA5` e classes Tailwind default `blue/gray/red/amber` soltas) por um sistema de tokens de design (paleta petróleo/âmbar/teal/danger, claro+escuro), introduzir a fonte Inter, agrupar o menu lateral sob "Configurações", e aplicar tudo isso ao shell (`AppLayout`) + três telas de maior tráfego (`DashboardMetrics`, `Processes`, `Board`) + aos 7 componentes base `shadcn/ui`.

**Architecture:** Tokens de cor/tipografia como CSS custom properties num bloco `@theme` em `apps/web/src/index.css` (mecanismo nativo do Tailwind v4), com overrides de valor em `@media (prefers-color-scheme: dark)` — sem JS, sem toggle manual. Os nomes de variável seguem a convenção já usada pelos componentes `shadcn/ui` deste projeto (`background`/`surface`/`border`/`foreground`/`muted-foreground`/`accent`), o que faz o Tailwind gerar utilitários como `bg-background`, `text-foreground`, `bg-accent` automaticamente. Migração é puramente de apresentação — nenhuma mudança de lógica, contrato de API ou schema.

**Tech Stack:** React 19, TailwindCSS v4, shadcn/ui (Radix), lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-20-visual-redesign-foundation-design.md`

## Global Constraints

- Nenhuma migration de banco, nenhuma mudança de contrato de API — troca é só de apresentação.
- Dark mode via `prefers-color-scheme` do SO apenas — sem toggle manual, sem estado em JS.
- Nenhum teste automatizado novo — mudança visual não é lógica de negócio (política do projeto). Os testes existentes (`*.test.tsx`) não fazem assert em cor hardcoded (confirmado antes desta spec) e devem continuar passando sem alteração.
- TypeScript `strict: true`, sem `any`.
- **Extensão feita durante o planejamento, fora do que a spec aprovada cobria explicitamente:** a spec definiu tokens de `warning` (âmbar), `success` (teal) e `neutral` (cinza), mas o app já usa vermelho (`red-500/600/700`, `bg-red-50/100/500`) em vários lugares para tarefas **atrasadas** (vencidas, não só "urgente") e para ações destrutivas/erro (botão `destructive`, borda de campo inválido). Isso não tinha um token equivalente na spec. Adicionei um 4º grupo semântico, **`danger`** (`--color-danger-bg`, `--color-danger-text`, `--color-danger-hover`), consistente com o mesmo padrão dos outros três. Sinalizar ao usuário ao final da execução — é uma extensão mecânica necessária pra completar a migração dos arquivos em escopo, não uma nova decisão de produto.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/web/src/index.css` | Modificar | Bloco `@theme` com tokens de cor/tipografia + overrides de dark mode |
| `apps/web/index.html` | Modificar | `<link>` do Google Fonts (Inter) |
| `apps/web/src/components/ui/button.tsx` | Modificar | Tokens nas variantes de botão |
| `apps/web/src/components/ui/card.tsx` | Modificar | Tokens em Card/CardTitle |
| `apps/web/src/components/ui/badge.tsx` | Modificar | Tokens nas variantes de badge |
| `apps/web/src/components/ui/dialog.tsx` | Modificar | Tokens em overlay/content/title |
| `apps/web/src/components/ui/input.tsx` | Modificar | Tokens em borda/placeholder/foco |
| `apps/web/src/components/ui/label.tsx` | Modificar | Token de texto |
| `apps/web/src/components/ui/textarea.tsx` | Modificar | Tokens em borda/placeholder/foco |
| `apps/web/src/pages/app/Dashboard.tsx` | Remover | Componente morto (nunca roteado) |
| `apps/web/src/router.tsx` | Modificar | Remover import do `Dashboard.tsx` morto |
| `apps/web/src/components/AppLayout.tsx` | Modificar | Tokens + agrupamento "Configurações" no menu |
| `apps/web/src/pages/app/DashboardMetrics.tsx` | Modificar | Tokens em KPIs, gráfico, painel "Em risco" |
| `apps/web/src/pages/app/Processes.tsx` | Modificar | Tokens (substituição mecânica via tabela) |
| `apps/web/src/pages/app/Board.tsx` | Modificar | Tokens (substituição mecânica via tabela) |

---

## Task 1: Tokens de design + fonte Inter

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/index.html`

- [ ] **Step 1: Reescrever `apps/web/src/index.css`**

Conteúdo atual é só `@import "tailwindcss";`. Substituir pelo arquivo completo:

```css
@import "tailwindcss";

@theme {
  --font-sans: 'Inter', -apple-system, 'Segoe UI', sans-serif;

  --color-background: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-border: #E7ECF3;
  --color-foreground: #0F1D2E;
  --color-muted-foreground: #64748B;
  --color-accent: #1E3A5F;
  --color-accent-hover: #2563A8;
  --color-warning-bg: #FEF3C7;
  --color-warning-text: #B45309;
  --color-success-bg: #ECFDF9;
  --color-success-text: #0D9488;
  --color-neutral-bg: #F1F5F9;
  --color-neutral-text: #64748B;
  --color-danger-bg: #FEE2E2;
  --color-danger-text: #DC2626;
  --color-danger-hover: #B91C1C;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-background: #0B1220;
    --color-surface: #131B2E;
    --color-border: #263449;
    --color-foreground: #F1F5F9;
    --color-muted-foreground: #94A3B8;
    --color-accent: #3B82F6;
    --color-accent-hover: #93C5FD;
    --color-warning-bg: #452C0A;
    --color-warning-text: #FBBF24;
    --color-success-bg: #0F2E2A;
    --color-success-text: #2DD4BF;
    --color-neutral-bg: #1E293B;
    --color-neutral-text: #94A3B8;
    --color-danger-bg: #450A0A;
    --color-danger-text: #F87171;
    --color-danger-hover: #FCA5A5;
  }
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Adicionar o link do Google Fonts em `apps/web/index.html`**

No `<head>`, depois da tag `<meta name="viewport" ...>` e antes de `<title>`:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Verificar que o dev server sobe sem erro e a fonte carrega**

```bash
pnpm --filter web dev
```
Abrir `http://localhost:5173/login` no navegador — o texto deve estar em Inter (verificar via devtools → Computed → font-family, deve mostrar "Inter" antes dos fallbacks), fundo da página deve ser `#F8FAFC` (ou `#0B1220` se o SO estiver em dark mode).

- [ ] **Step 4: Rodar a suíte de testes do web pra garantir que nada quebrou**

```bash
pnpm --filter web test
```
Expected: todos os testes continuam passando (mudança é só CSS, nenhuma lógica tocada).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/index.css apps/web/index.html
git commit -m "feat(design): tokens de cor/tipografia (claro+escuro) e fonte Inter"
```

---

## Task 2: Restilizar os 7 componentes base `shadcn/ui`

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/label.tsx`
- Modify: `apps/web/src/components/ui/textarea.tsx`

**Depende do Task 1** (os tokens precisam existir antes de usar as classes `bg-accent` etc.)

- [ ] **Step 1: `apps/web/src/components/ui/button.tsx`**

Trocar o bloco `variantClasses` e a linha do `focus-visible:ring`:

```typescript
const variantClasses = {
  default: 'bg-accent text-white hover:bg-accent-hover',
  outline: 'border border-border bg-surface text-foreground hover:bg-neutral-bg',
  ghost: 'text-foreground hover:bg-neutral-bg',
  destructive: 'bg-danger-text text-white hover:bg-danger-hover',
}
```
E na `className` do `<button>`, trocar `focus-visible:ring-blue-500` por `focus-visible:ring-accent`.

- [ ] **Step 2: `apps/web/src/components/ui/card.tsx`**

Trocar:
- `'rounded-lg border border-gray-200 bg-white shadow-sm'` → `'rounded-lg border border-border bg-surface shadow-sm'`
- `'text-base font-semibold text-gray-900'` → `'text-base font-semibold text-foreground'`

- [ ] **Step 3: `apps/web/src/components/ui/badge.tsx`**

Trocar o bloco de variantes:

```typescript
        variant === 'default' && 'bg-accent/10 text-accent',
        variant === 'secondary' && 'bg-neutral-bg text-neutral-text',
        variant === 'outline' && 'border border-border text-muted-foreground',
```

- [ ] **Step 4: `apps/web/src/components/ui/dialog.tsx`**

Trocar:
- `'fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg bg-white p-6 shadow-xl'` → mesma string trocando `bg-white` por `bg-surface`
- `'text-lg font-semibold text-gray-900'` → `'text-lg font-semibold text-foreground'`

(O overlay `bg-black/50` fica como está — não é cor de marca, é um scrim.)

- [ ] **Step 5: `apps/web/src/components/ui/input.tsx`**

Trocar a string de classes por:
```typescript
        'flex h-9 w-full rounded-md border border-border bg-surface px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
```

- [ ] **Step 6: `apps/web/src/components/ui/label.tsx`**

Trocar `'text-sm font-medium text-gray-700 leading-none peer-disabled:opacity-70'` → `'text-sm font-medium text-foreground leading-none peer-disabled:opacity-70'`

- [ ] **Step 7: `apps/web/src/components/ui/textarea.tsx`**

Trocar a string de classes por:
```typescript
        'flex min-h-[80px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
```

- [ ] **Step 8: Rodar a suíte de testes do web**

```bash
pnpm --filter web test
```
Expected: continua tudo passando (nenhum teste faz assert em classe/cor destes componentes).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(design): aplicar tokens de design aos componentes base shadcn/ui"
```

---

## Task 3: Remover `Dashboard.tsx` morto

**Files:**
- Delete: `apps/web/src/pages/app/Dashboard.tsx`
- Modify: `apps/web/src/router.tsx`

Confirmado durante o brainstorming: `Dashboard` é importado em `router.tsx` mas nunca usado como `element` de nenhuma rota — a rota real `/app/dashboard` usa `DashboardMetrics`.

- [ ] **Step 1: Confirmar de novo que não há uso, antes de apagar**

```bash
grep -n "Dashboard" apps/web/src/router.tsx
```
Expected: a única ocorrência de `Dashboard` (sem `Metrics`/`Master` no nome) deve ser a linha `import Dashboard from '@/pages/app/Dashboard'` — nenhuma linha com `<Dashboard `.

- [ ] **Step 2: Apagar o arquivo**

```bash
rm apps/web/src/pages/app/Dashboard.tsx
```

- [ ] **Step 3: Remover o import órfão em `apps/web/src/router.tsx`**

Remover a linha:
```typescript
import Dashboard from '@/pages/app/Dashboard'
```

- [ ] **Step 4: Rodar type-check e a suíte de testes**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
```
Expected: `tsc` sem erro (nenhuma outra parte do código importava esse componente), testes continuam passando.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/pages/app/Dashboard.tsx apps/web/src/router.tsx
git commit -m "chore: remover Dashboard.tsx morto (nunca roteado, DashboardMetrics é a tela real)"
```

---

## Task 4: `AppLayout.tsx` — tokens + agrupamento "Configurações"

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`

**Depende do Task 1.**

- [ ] **Step 1: Substituir o arquivo inteiro**

```typescript
import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useRequestsBadgeStream } from '@/hooks/useRequestsBadgeStream'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, Inbox, Menu, X, UserCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
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
  const isOrgRole = ORG_ROLES.includes(role)

  const { data: pendingCount } = useQuery<{ count: number }>({
    queryKey: ['requests-pending-count'],
    queryFn: () => api.get('/requests/pending-count').then((r) => r.data),
    enabled: isOrgRole,
    refetchOnWindowFocus: true,
  })

  useRequestsBadgeStream()

  return (
    <div className="flex h-screen bg-background">
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
          'fixed inset-y-0 left-0 z-50 w-56 bg-surface border-r border-border flex flex-col',
          'transition-transform duration-200',
          'md:relative md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-accent to-accent-hover flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-foreground leading-none">Tramita</h1>
              <p className="text-xs text-muted-foreground truncate">{user?.name}</p>
            </div>
          </div>
          <button
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {ORG_ROLES.includes(role) && (
            <SidebarSectionLabel>Geral</SidebarSectionLabel>
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/processes" icon={<ClipboardList size={16} />} label="Processos" onClick={handleNavClick} />
          )}
          {ORG_ROLES.includes(role) && (
            <SidebarLink
              to="/app/requests"
              icon={<Inbox size={16} />}
              label="Solicitações"
              badge={pendingCount?.count}
              onClick={handleNavClick}
            />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" onClick={handleNavClick} />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" onClick={handleNavClick} />
          )}

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
        </nav>

        <div className="p-3 border-t border-border space-y-1">
          <SidebarLink to="/app/perfil" icon={<UserCircle size={16} />} label="Meu Perfil" onClick={handleNavClick} />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-neutral-bg"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top-bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface border-b border-border flex-shrink-0">
          <button
            aria-label="Abrir menu de navegação"
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-base font-bold text-accent">Tramita</h1>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1.5 mt-3 first:mt-0">
      {children}
    </div>
  )
}

function SidebarLink({
  to,
  icon,
  label,
  badge,
  onClick,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
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
            ? 'bg-neutral-bg text-accent font-medium'
            : 'text-muted-foreground hover:bg-neutral-bg',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && badge > 0 && (
        <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-text text-white text-xs font-medium flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </NavLink>
  )
}
```

Nota: a única mudança estrutural (não só de cor) é a função `SidebarSectionLabel` nova e as duas chamadas dela (`Geral` antes do primeiro grupo, `Configurações` antes de Templates/Notificações/Assinatura) — é estático, sem expand/collapse, igual ao mockup aprovado.

- [ ] **Step 2: Rodar o dev server e conferir visualmente**

```bash
pnpm --filter web dev
```
Login como ORG_ADMIN, conferir: labels "GERAL" e "CONFIGURAÇÕES" aparecem no menu, ícone com gradiente aparece ao lado de "Tramita" no topo da sidebar, item ativo destaca com fundo `neutral-bg` e texto `accent`.

- [ ] **Step 3: Rodar a suíte de testes**

```bash
pnpm --filter web test
```
Expected: continua passando (nenhum teste existente cobre `AppLayout.tsx` diretamente, mas confirmar que nada mais quebrou).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx
git commit -m "feat(design): aplicar tokens ao AppLayout e agrupar menu sob Configurações"
```

---

## Task 5: `DashboardMetrics.tsx` — tokens

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

**Depende do Task 1.**

- [ ] **Step 1: Substituir o arquivo inteiro**

```typescript
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

// REVIEW usa roxo (bg-violet-400) intencionalmente fora dos tokens — é só uma
// cor categórica de gráfico (4 status distintos), não um estado semântico
// (warning/success/danger) reaproveitado em outro lugar do app.
const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-accent',
  IN_PROGRESS: 'bg-warning-text',
  REVIEW: 'bg-violet-400',
  DONE: 'bg-success-text',
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
    return <div className="p-8 text-muted-foreground">Carregando métricas...</div>
  }

  const { kpis, tasksByStatus, atRisk } = data

  const maxTaskCount = Math.max(...Object.values(tasksByStatus), 1)

  const kpiCards = [
    { label: 'Processos ativos', value: kpis.activeBoards, color: 'border-accent', textColor: 'text-accent' },
    { label: 'Atrasados', value: kpis.overdueBoards, color: 'border-warning-text', textColor: 'text-warning-text' },
    { label: 'Concluídos no mês', value: kpis.completedTasksThisMonth, color: 'border-success-text', textColor: 'text-success-text' },
    { label: 'Tarefas urgentes abertas', value: kpis.urgentOpenTasks, color: 'border-danger-text', textColor: 'text-danger-text' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <div key={card.label} className={cn('bg-surface rounded-lg border-l-4 p-4 shadow-sm', card.color)}>
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className={cn('text-3xl font-bold mt-1', card.textColor)}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de barras — tarefas por status */}
        <div className="lg:col-span-2 bg-surface rounded-lg shadow-sm p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Tarefas por status</h2>
          <div className="flex items-end gap-2 md:gap-6 h-40">
            {Object.entries(tasksByStatus).map(([status, count]) => (
              <div key={status} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{count}</span>
                <div className="w-full flex items-end" style={{ height: '100px' }}>
                  <div
                    className={cn('w-full rounded-t-md transition-all', STATUS_COLORS[status])}
                    style={{ height: `${Math.max((count / maxTaskCount) * 100, count > 0 ? 8 : 0)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Painel em risco */}
        <div className="bg-surface rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Em risco</h2>
            <Link to="/app/processes" className="text-xs text-accent hover:underline">
              Ver todos
            </Link>
          </div>

          {atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum processo em risco 🎉</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-72">
              {atRisk.map((item) => {
                const isOverdue = item.daysOverdue > 0
                return (
                  <Link
                    key={item.boardId}
                    to={`/app/board/${item.boardId}`}
                    className={cn(
                      'block rounded-md p-3 border-l-2 hover:bg-neutral-bg transition-colors',
                      isOverdue ? 'border-danger-text bg-danger-bg' : 'border-warning-text bg-warning-bg',
                    )}
                  >
                    <p className="text-sm font-medium text-foreground truncate">{item.boardTitle}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.clientName}</p>
                    <p className={cn('text-xs font-medium mt-0.5', isOverdue ? 'text-danger-text' : 'text-warning-text')}>
                      {formatDaysOverdue(item.daysOverdue, item.mostUrgentDueDate)}
                    </p>
                  </Link>
                )
              })}
            </div>
          )}

          <Link
            to="/app/processes"
            className="mt-3 block text-center text-xs text-accent hover:underline"
          >
            Ver todos os processos →
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rodar o dev server e conferir visualmente contra o mockup aprovado**

```bash
pnpm --filter web dev
```
Login como ORG_ADMIN, ir em `/app/dashboard`. Conferir: os 4 KPI cards usam as cores certas (accent/warning/success/danger), o gráfico de barras usa as 4 cores (accent/warning/violet-400/success), o painel "Em risco" usa `danger-bg`/`warning-bg` conforme atrasado ou não.

- [ ] **Step 3: Rodar a suíte de testes**

```bash
pnpm --filter web test
```
Expected: continua passando.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(design): aplicar tokens ao DashboardMetrics"
```

---

## Task 6: `Processes.tsx` — tokens (substituição mecânica)

**Files:**
- Modify: `apps/web/src/pages/app/Processes.tsx`

**Depende do Task 1.** Arquivo tem 477 linhas — em vez de reescrever o arquivo inteiro aqui, aplicar a tabela de substituição abaixo em **toda ocorrência** de cada padrão no arquivo (usar busca-e-substituição, não reescrever manualmente linha por linha).

- [ ] **Step 1: Aplicar a tabela de substituição de classes**

| Classe atual | Nova classe | Contexto |
|---|---|---|
| `#185FA5` (em `bg-[#185FA5]`, `text-[#185FA5]`, `hover:bg-[#185FA5]` etc.) | trocar pela classe de token equivalente: `bg-[#185FA5]`→`bg-accent`, `text-[#185FA5]`→`text-accent`, `hover:bg-[#185FA5]`→`hover:bg-accent-hover`, `border-[#185FA5]`→`border-accent` | Botões/links primários |
| `#0C447C` (em `hover:bg-[#0C447C]` etc.) | `hover:bg-accent-hover` | Hover de botão/link primário |
| `bg-blue-50`, `text-blue-700` (badge/destaque azul) | `bg-accent/10`, `text-accent` | Badges de destaque |
| `bg-blue-500`, `ring-blue-500` | `bg-accent`, `ring-accent` | Elementos de foco/destaque |
| `bg-gray-50`, `bg-gray-100`, `bg-gray-200` | `bg-neutral-bg` — **exceção:** se for o `<div>` raiz que representa o fundo de toda a página (não um badge/pill/hover), usar `bg-background` em vez disso | Fundo neutro / hover / badge de status "pendente" |
| `border-gray-100`, `border-gray-200`, `border-gray-300` | `border-border` | Bordas de card/linha/input |
| `text-gray-900` | `text-foreground` | Títulos, texto principal |
| `text-gray-700`, `text-gray-600` | `text-foreground` se for texto de conteúdo principal da linha (ex: título do processo); `text-muted-foreground` se for texto secundário/label | Ver nota abaixo |
| `text-gray-500`, `text-gray-400`, `text-gray-300` | `text-muted-foreground` | Texto secundário, placeholder, ícone inativo |
| `bg-amber-50`, `text-amber-500/600/700` | `bg-warning-bg`, `text-warning-text` | Badge "vence em breve" |
| `bg-green-50`, `bg-green-500`, `text-green-600/700` | `bg-success-bg` (ou `bg-success-text` se for um dot/indicador sólido pequeno), `text-success-text` | Badge "concluído" |
| `bg-red-50`, `bg-red-500`, `border-red-500`, `text-red-500/600/700` | `bg-danger-bg` (ou `bg-danger-text` se for indicador sólido), `border-danger-text`, `text-danger-text` | Badge "atrasado", validação de erro |

**Nota sobre `text-gray-700`/`text-gray-600` (única linha com julgamento, não é 100% mecânica):** ao encontrar essas classes, olhar o elemento — se é o texto principal de um item (título de processo, nome), usar `text-foreground`; se é um label pequeno, contador, ou texto de apoio, usar `text-muted-foreground`. Na dúvida, `text-muted-foreground` é a escolha mais segura (é o padrão do resto da tabela pra tons médios de cinza).

- [ ] **Step 2: Conferir que nenhuma cor hardcoded/Tailwind-default sobrou fora do escopo esperado**

```bash
grep -n "text-blue-\|bg-blue-\|border-blue-\|#185FA5\|#0C447C\|#378ADD\|text-red-\|bg-red-\|border-red-\|text-amber-\|bg-amber-\|text-green-\|bg-green-\|text-gray-\|bg-gray-\|border-gray-" apps/web/src/pages/app/Processes.tsx
```
Expected: nenhuma ocorrência (todas foram migradas pra token). Se sobrar alguma, aplicar a linha correspondente da tabela.

- [ ] **Step 3: Rodar o dev server e conferir visualmente**

```bash
pnpm --filter web dev
```
Ir em `/app/processes`, conferir card de estatísticas, linhas de processo (badge de status colorido, indicador de atraso), filtros — tudo usando as cores novas, sem nenhum azul/cinza antigo aparecendo.

- [ ] **Step 4: Rodar a suíte de testes**

```bash
pnpm --filter web test
```
Expected: continua passando.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/Processes.tsx
git commit -m "feat(design): aplicar tokens de design ao Processes"
```

---

## Task 7: `Board.tsx` — tokens (substituição mecânica)

**Files:**
- Modify: `apps/web/src/pages/app/Board.tsx`

**Depende do Task 1.** Mesma abordagem do Task 6 — 288 linhas, usar a mesma tabela de substituição.

- [ ] **Step 1: Aplicar a mesma tabela de substituição do Task 6, Step 1**

Classes encontradas neste arquivo: `#185FA5`, `#0C447C`, `bg-amber-50`, `bg-gray-50/100`, `border-gray-100/200/300`, `bg-red-100`, `ring-blue-500`, `text-amber-700`, `text-gray-400/500/600/700/800/900`, `text-red-700`.

Aplicar a mesma tabela do Task 6. Ponto de atenção específico deste arquivo: `bg-red-100`/`text-red-700` aqui provavelmente é o indicador de tarefa atrasada dentro de um card do Kanban — mapear pra `bg-danger-bg`/`text-danger-text` mesmo assim (mesmo padrão semântico usado em `DashboardMetrics`/`Processes`).

- [ ] **Step 2: Conferir que nenhuma cor sobrou fora do escopo esperado**

```bash
grep -n "text-blue-\|bg-blue-\|border-blue-\|#185FA5\|#0C447C\|#378ADD\|text-red-\|bg-red-\|border-red-\|text-amber-\|bg-amber-\|text-green-\|bg-green-\|text-gray-\|bg-gray-\|border-gray-" apps/web/src/pages/app/Board.tsx
```
Expected: nenhuma ocorrência.

- [ ] **Step 3: Rodar o dev server e conferir visualmente**

```bash
pnpm --filter web dev
```
Abrir um board (`/app/board/:id`), conferir colunas, cards de tarefa, indicador de prioridade/atraso — tudo com as cores novas.

- [ ] **Step 4: Rodar a suíte de testes**

```bash
pnpm --filter web test
```
Expected: continua passando (`TaskCard.test.tsx` existe e cobre esse componente — conferir especificamente que ele passa).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/Board.tsx
git commit -m "feat(design): aplicar tokens de design ao Board"
```

---

## Task 8: Verificação final — claro e escuro, todas as telas em escopo

**Files:** nenhum arquivo novo — só verificação.

- [ ] **Step 1: Rodar a suíte completa (API + web) uma última vez**

```bash
pnpm test
```
Expected: tudo passando.

- [ ] **Step 2: Percorrer visualmente todas as telas em escopo, nos dois modos**

```bash
pnpm --filter web dev
```
Comparar cada uma contra o mockup aprovado (salvo em `.superpowers/brainstorm/`, sessão `719737-1789921877`, arquivo `layout-full.html`), em modo claro e forçando `prefers-color-scheme: dark` nas devtools do navegador:
- `/login` (fonte Inter, cores de fundo)
- `/app/dashboard` (`DashboardMetrics`)
- `/app/processes`
- `/app/board/:id`
- Sidebar (`AppLayout`) em ambas as telas acima — conferir os grupos "Geral"/"Configurações"

- [ ] **Step 3: Type-check final**

```bash
pnpm --filter web exec tsc --noEmit
```
Expected: zero erros.

- [ ] **Step 4: Reportar ao usuário a extensão do token `danger` (ver Global Constraints) feita durante a execução, caso ainda não tenha sido comunicada.**

---

## Self-Review

- **Cobertura do escopo:** todos os arquivos listados na spec (`index.css`, `index.html`, AppLayout, DashboardMetrics, Processes, Board, 7 componentes `ui/`, remoção do `Dashboard.tsx` morto) têm uma task correspondente.
- **Sem placeholders:** Tasks 1, 2, 4, 5 têm código completo e literal. Tasks 6 e 7 usam uma tabela de substituição mecânica em vez de reescrever 477/288 linhas — é uma instrução executável e não-ambígua (a única linha com julgamento humano, `text-gray-700/600`, está marcada como tal explicitamente), não uma instrução vaga do tipo "estilize apropriadamente".
- **Consistência:** os nomes de token (`bg-accent`, `text-foreground`, `bg-warning-bg` etc.) são usados de forma idêntica em todas as tasks — nenhuma task inventa um nome de classe diferente pro mesmo conceito.
- **Extensão sinalizada:** o token `danger` (não estava na spec original) está documentado nas Global Constraints e repetido como lembrete no Task 8 — para garantir que o usuário saiba dessa decisão tomada durante o planejamento.
