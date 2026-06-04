# Fase 6: Frontend Interno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o painel interno do Tramita para escritórios contábeis (roles ORG_*): setup de TailwindCSS v4 + shadcn/ui + @dnd-kit + Vitest/jsdom, route guards, AppLayout com sidebar, Kanban com optimistic update, telas de gestão e settings, e os 4 testes obrigatórios.

**Architecture:** Componentes isolados com responsabilidade única em `src/components/`. Estado de servidor via TanStack Query v5 (fetch + optimistic mutations). Route guards via `ProtectedRoute` wrapper. Todas as rotas `/app/*` exigem `ORG_*` role. Testes com Vitest + jsdom + MSW (mock de chamadas axios).

**Tech Stack:** React 19, Vite 6, React Router v7, TanStack Query v5, axios, TailwindCSS v4 (@tailwindcss/vite), @dnd-kit/core + @dnd-kit/sortable, Vitest + jsdom + @testing-library/react + MSW v2.

---

## File Map

**Criar:**
- `apps/web/src/types/index.ts` — tipos compartilhados (Task, Column, Board, User, Client)
- `apps/web/src/lib/utils.ts` — helper `cn()`
- `apps/web/src/test/setup.ts` — jest-dom + MSW lifecycle
- `apps/web/src/test/server.ts` — MSW setupServer
- `apps/web/src/index.css` — `@import "tailwindcss"`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ProtectedRoute.tsx`
- `apps/web/src/components/AppLayout.tsx`
- `apps/web/src/components/TaskCard.tsx`
- `apps/web/src/components/TaskCard.test.tsx` ← OBRIGATÓRIO
- `apps/web/src/components/TaskModal.tsx`
- `apps/web/src/components/TaskModal.test.tsx` ← OBRIGATÓRIO
- `apps/web/src/components/TemplateEditor.tsx`
- `apps/web/src/components/TemplateEditor.test.tsx` ← OBRIGATÓRIO
- `apps/web/src/hooks/useBoard.ts`
- `apps/web/src/hooks/useBoard.test.ts` ← OBRIGATÓRIO
- `apps/web/src/pages/app/Dashboard.tsx`
- `apps/web/src/pages/app/Board.tsx`
- `apps/web/src/pages/app/Clients.tsx`
- `apps/web/src/pages/app/Users.tsx`
- `apps/web/src/pages/app/settings/Templates.tsx`
- `apps/web/src/pages/app/settings/Notifications.tsx`
- `apps/web/src/pages/app/settings/Subscription.tsx`

**Modificar:**
- `apps/web/vite.config.ts` — adicionar tailwindcss plugin + bloco test
- `apps/web/tsconfig.json` — adicionar `"types": ["vitest/globals"]`
- `apps/web/src/router.tsx` — adicionar rotas `/app/*` com ProtectedRoute
- `apps/web/src/main.tsx` — importar `src/index.css`
- `docs/TASKS.md` — marcar Fase 6 como concluída

---

## Task 1: Setup — deps + TailwindCSS v4 + Vitest + MSW + types

**Files:**
- Modify: `apps/web/package.json` (via pnpm add)
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/test/server.ts`
- Create: `apps/web/src/types/index.ts`
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Instalar dependências**

```bash
cd /home/max/job/autohubs/tramita

# TailwindCSS v4
pnpm --filter web add -D tailwindcss @tailwindcss/vite

# shadcn/ui base
pnpm --filter web add class-variance-authority clsx tailwind-merge lucide-react

# Radix UI (primitivos usados pelos componentes)
pnpm --filter web add @radix-ui/react-dialog @radix-ui/react-label

# DnD Kit
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Testes
pnpm --filter web add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom msw
```

- [ ] **Step 2: Atualizar `apps/web/vite.config.ts`**

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

- [ ] **Step 3: Atualizar `apps/web/tsconfig.json`**

Substituir o campo `"types"` para incluir `vitest/globals`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "outDir": "dist",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Criar `apps/web/src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 5: Atualizar `apps/web/src/main.tsx`**

Adicionar import do CSS antes de `import App`:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: Criar `apps/web/src/test/server.ts`**

```typescript
// apps/web/src/test/server.ts
import { setupServer } from 'msw/node'
export const server = setupServer()
```

- [ ] **Step 7: Criar `apps/web/src/test/setup.ts`**

```typescript
// apps/web/src/test/setup.ts
import '@testing-library/jest-dom'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

- [ ] **Step 8: Criar `apps/web/src/types/index.ts`**

```typescript
// apps/web/src/types/index.ts
export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED'
  position: number
  columnId: string
  assigneeId: string | null
  creatorId: string
  dueDate: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Column {
  id: string
  title: string
  position: number
  color: string | null
  isFinal: boolean
  boardId: string
  tasks: Task[]
}

export interface Board {
  id: string
  title: string
  description: string | null
  clientId: string
  organizationId: string
  isActive: boolean
  columns: Column[]
  client: { id: string; name: string }
}

export interface User {
  id: string
  name: string
  email: string
  role: 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
  phone: string | null
  isActive: boolean
  createdAt: string
}

export interface Client {
  id: string
  name: string
  cnpj: string | null
  email: string
  whatsapp: string | null
  isActive: boolean
  createdAt: string
}
```

- [ ] **Step 9: Criar `apps/web/src/lib/utils.ts`**

```typescript
// apps/web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 10: Verificar que o build compila**

```bash
pnpm --filter web build 2>&1 | tail -10
```

Esperado: build sem erros (pode ter warnings de CSS).

- [ ] **Step 11: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/ pnpm-lock.yaml
git -C /home/max/job/autohubs/tramita commit -m "chore: setup TailwindCSS v4 + Vitest jsdom + MSW + tipos compartilhados"
```

---

## Task 2: UI Primitives (componentes mínimos shadcn/ui)

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/textarea.tsx`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/ui/button.tsx`**

```typescript
// apps/web/src/components/ui/button.tsx
import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'default' | 'sm' | 'lg'
}

const variantClasses = {
  default: 'bg-blue-600 text-white hover:bg-blue-700',
  outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
  ghost: 'text-gray-700 hover:bg-gray-100',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
}

const sizeClasses = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-7 px-3 text-xs',
  lg: 'h-11 px-6 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 2: Criar `apps/web/src/components/ui/card.tsx`**

```typescript
// apps/web/src/components/ui/card.tsx
import { cn } from '@/lib/utils'
import { type HTMLAttributes } from 'react'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-gray-200 bg-white shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-gray-900', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}
```

- [ ] **Step 3: Criar `apps/web/src/components/ui/input.tsx`**

```typescript
// apps/web/src/components/ui/input.tsx
import { cn } from '@/lib/utils'
import { type InputHTMLAttributes, forwardRef } from 'react'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
```

- [ ] **Step 4: Criar `apps/web/src/components/ui/textarea.tsx`**

```typescript
// apps/web/src/components/ui/textarea.tsx
import { cn } from '@/lib/utils'
import { type TextareaHTMLAttributes, forwardRef } from 'react'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
```

- [ ] **Step 5: Criar `apps/web/src/components/ui/label.tsx`**

```typescript
// apps/web/src/components/ui/label.tsx
import { cn } from '@/lib/utils'
import * as LabelPrimitive from '@radix-ui/react-label'

export function Label({ className, ...props }: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium text-gray-700 leading-none peer-disabled:opacity-70', className)}
      {...props}
    />
  )
}
```

- [ ] **Step 6: Criar `apps/web/src/components/ui/badge.tsx`**

```typescript
// apps/web/src/components/ui/badge.tsx
import { cn } from '@/lib/utils'
import { type HTMLAttributes } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-blue-100 text-blue-700',
        variant === 'secondary' && 'bg-gray-100 text-gray-600',
        variant === 'outline' && 'border border-gray-300 text-gray-600',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 7: Criar `apps/web/src/components/ui/dialog.tsx`**

```typescript
// apps/web/src/components/ui/dialog.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg bg-white p-6 shadow-xl',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold text-gray-900', className)}
      {...props}
    />
  )
}
```

- [ ] **Step 8: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/ui/
git -C /home/max/job/autohubs/tramita commit -m "feat: UI primitivos — Button, Card, Input, Textarea, Badge, Dialog"
```

---

## Task 3: ProtectedRoute + AppLayout + router

**Files:**
- Create: `apps/web/src/components/ProtectedRoute.tsx`
- Create: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/ProtectedRoute.tsx`**

```typescript
// apps/web/src/components/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  allowedRoles: string[]
  children: React.ReactNode
}

export function ProtectedRoute({ allowedRoles, children }: Props) {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(user?.role ?? '')) return <Navigate to="/login" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Criar `apps/web/src/components/AppLayout.tsx`**

```typescript
// apps/web/src/components/AppLayout.tsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export default function AppLayout() {
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

  const role = user?.role ?? ''

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-600">Tramita</h1>
          <p className="text-xs text-gray-500 truncate">{user?.name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          )}
          {MANAGER_ROLES.includes(role) && (
            <SidebarLink to="/app/clients" icon={<UserCheck size={16} />} label="Clientes" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/users" icon={<Users size={16} />} label="Usuários" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/templates" icon={<Settings size={16} />} label="Templates" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/notifications" icon={<Bell size={16} />} label="Notificações" />
          )}
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/subscription" icon={<CreditCard size={16} />} label="Assinatura" />
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function SidebarLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
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

- [ ] **Step 3: Atualizar `apps/web/src/router.tsx`**

Substituir o conteúdo completo do arquivo:

```typescript
// apps/web/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import MasterLayout from '@/pages/master/Layout'
import MasterDashboard from '@/pages/master/Dashboard'
import MasterPlans from '@/pages/master/Plans'
import MasterOrganizations from '@/pages/master/Organizations'
import OrgSubscription from '@/pages/org/Subscription'
import Dashboard from '@/pages/app/Dashboard'
import Board from '@/pages/app/Board'
import Clients from '@/pages/app/Clients'
import Users from '@/pages/app/Users'
import Templates from '@/pages/app/settings/Templates'
import Notifications from '@/pages/app/settings/Notifications'
import AppSubscription from '@/pages/app/settings/Subscription'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']
const MANAGER_ROLES = ['ORG_ADMIN', 'ORG_MANAGER']
const ADMIN_ROLES = ['ORG_ADMIN']

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/master',
    element: <MasterLayout />,
    children: [
      { index: true, element: <Navigate to="/master/dashboard" replace /> },
      { path: 'dashboard', element: <MasterDashboard /> },
      { path: 'plans', element: <MasterPlans /> },
      { path: 'organizations', element: <MasterOrganizations /> },
    ],
  },
  { path: '/org/subscription', element: <OrgSubscription /> },
  {
    path: '/app',
    element: (
      <ProtectedRoute allowedRoles={ORG_ROLES}>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/app/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'board/:boardId', element: <Board /> },
      {
        path: 'clients',
        element: (
          <ProtectedRoute allowedRoles={MANAGER_ROLES}>
            <Clients />
          </ProtectedRoute>
        ),
      },
      {
        path: 'users',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Users />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/templates',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Templates />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/notifications',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Notifications />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings/subscription',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <AppSubscription />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
])
```

**IMPORTANTE:** As páginas importadas (`Dashboard`, `Board`, `Clients`, `Users`, `Templates`, `Notifications`, `AppSubscription`) ainda não existem. Crie stubs mínimos para o router compilar antes de criar as páginas completas nas tasks seguintes:

```bash
mkdir -p /home/max/job/autohubs/tramita/apps/web/src/pages/app/settings
```

Criar stub para cada página ausente (conteúdo mínimo — apenas o nome):
- `apps/web/src/pages/app/Dashboard.tsx` → `export default function Dashboard() { return <div>Dashboard</div> }`
- `apps/web/src/pages/app/Board.tsx` → `export default function Board() { return <div>Board</div> }`
- `apps/web/src/pages/app/Clients.tsx` → `export default function Clients() { return <div>Clientes</div> }`
- `apps/web/src/pages/app/Users.tsx` → `export default function Users() { return <div>Usuários</div> }`
- `apps/web/src/pages/app/settings/Templates.tsx` → `export default function Templates() { return <div>Templates</div> }`
- `apps/web/src/pages/app/settings/Notifications.tsx` → `export default function Notifications() { return <div>Notificações</div> }`
- `apps/web/src/pages/app/settings/Subscription.tsx` → `export default function AppSubscription() { return <div>Assinatura</div> }`

- [ ] **Step 4: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/
git -C /home/max/job/autohubs/tramita commit -m "feat: ProtectedRoute + AppLayout + rotas /app/* com stubs de página"
```

---

## Task 4: TaskCard (TDD)

**Files:**
- Create: `apps/web/src/components/TaskCard.test.tsx`
- Create: `apps/web/src/components/TaskCard.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/TaskCard.test.tsx`**

```typescript
// apps/web/src/components/TaskCard.test.tsx
import { render, screen } from '@testing-library/react'
import { TaskCard } from '@/components/TaskCard'
import type { Task } from '@/types'

const baseTask: Task = {
  id: '1',
  title: 'Abertura LTDA',
  priority: 'HIGH',
  status: 'OPEN',
  position: 0,
  columnId: 'col1',
  tags: [],
  creatorId: 'u1',
  assigneeId: null,
  dueDate: null,
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

it('renders task title', () => {
  render(<TaskCard task={baseTask} onClick={() => {}} />)
  expect(screen.getByText('Abertura LTDA')).toBeInTheDocument()
})

it('renders priority badge with correct color class for HIGH', () => {
  render(<TaskCard task={baseTask} onClick={() => {}} />)
  const badge = screen.getByText('HIGH')
  expect(badge).toHaveClass('bg-orange-100')
})

it('highlights overdue task when dueDate is in the past and status is not DONE', () => {
  const overdueTask: Task = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z' }
  const { container } = render(<TaskCard task={overdueTask} onClick={() => {}} />)
  expect(container.firstChild).toHaveClass('border-red-400')
})

it('does not highlight completed task even if dueDate is in the past', () => {
  const doneTask: Task = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z', status: 'DONE' }
  const { container } = render(<TaskCard task={doneTask} onClick={() => {}} />)
  expect(container.firstChild).not.toHaveClass('border-red-400')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter web test src/components/TaskCard.test.tsx 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/components/TaskCard'".

- [ ] **Step 3: Criar `apps/web/src/components/TaskCard.tsx`**

```typescript
// apps/web/src/components/TaskCard.tsx
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

const PRIORITY_STYLES: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

interface Props {
  task: Task
  onClick: () => void
}

export function TaskCard({ task, onClick }: Props) {
  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  return (
    <div
      className={cn(
        'bg-white rounded-lg p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow select-none',
        isOverdue ? 'border-red-400' : 'border-gray-200',
      )}
      onClick={onClick}
    >
      <p className="text-sm font-medium text-gray-800 mb-2 line-clamp-2">{task.title}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            'inline-flex text-xs font-medium px-2 py-0.5 rounded-full',
            PRIORITY_STYLES[task.priority],
          )}
        >
          {task.priority}
        </span>
        {isOverdue && (
          <span className="text-xs text-red-500 font-medium">⚠ Prazo vencido</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter web test src/components/TaskCard.test.tsx --reporter=verbose 2>&1 | tail -12
```

Esperado: 4 testes PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/TaskCard.tsx apps/web/src/components/TaskCard.test.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: TaskCard — badge de prioridade + destaque de prazo vencido (TDD)"
```

---

## Task 5: TaskModal (TDD)

**Files:**
- Create: `apps/web/src/components/TaskModal.test.tsx`
- Create: `apps/web/src/components/TaskModal.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/TaskModal.test.tsx`**

```typescript
// apps/web/src/components/TaskModal.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TaskModal } from '@/components/TaskModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Task } from '@/types'

const task: Task = {
  id: 'task-1',
  title: 'Tarefa teste',
  priority: 'MEDIUM',
  status: 'OPEN',
  description: '',
  assigneeId: null,
  dueDate: null,
  tags: [],
  position: 0,
  columnId: 'col1',
  creatorId: 'u1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('submits PATCH /tasks/:id with correct payload on save', async () => {
  let capturedBody: unknown
  server.use(
    http.patch('http://localhost:3000/tasks/task-1', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({ ...task, title: 'Novo título' })
    }),
    http.get('http://localhost:3000/users', () => HttpResponse.json([])),
  )

  render(<TaskModal task={task} open onClose={() => {}} />, { wrapper })

  const titleInput = screen.getByLabelText('Título')
  await userEvent.clear(titleInput)
  await userEvent.type(titleInput, 'Novo título')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ title: 'Novo título' })
  })
})

it('calls onClose when cancel button is clicked', async () => {
  server.use(http.get('http://localhost:3000/users', () => HttpResponse.json([])))
  const onClose = vi.fn()
  render(<TaskModal task={task} open onClose={onClose} />, { wrapper })
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(onClose).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter web test src/components/TaskModal.test.tsx 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/components/TaskModal'".

- [ ] **Step 3: Criar `apps/web/src/components/TaskModal.tsx`**

```typescript
// apps/web/src/components/TaskModal.tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Task } from '@/types'

interface Props {
  task: Task
  open: boolean
  onClose: () => void
}

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export function TaskModal({ task, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(task.title)
  const [priority, setPriority] = useState(task.priority)

  const mutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      onClose()
    },
  })

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
        <h2 className="text-lg font-semibold mb-4">Editar tarefa</h2>

        <div className="space-y-4">
          <div>
            <Label htmlFor="task-title">Título</Label>
            <Input
              id="task-title"
              aria-label="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="task-priority">Prioridade</Label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task['priority'])}
              className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate({ title, priority })}
            disabled={mutation.isPending}
          >
            Salvar
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter web test src/components/TaskModal.test.tsx --reporter=verbose 2>&1 | tail -10
```

Esperado: 2 testes PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/TaskModal.tsx apps/web/src/components/TaskModal.test.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: TaskModal — edição de tarefa com PATCH (TDD)"
```

---

## Task 6: useBoard hook (TDD)

**Files:**
- Create: `apps/web/src/hooks/useBoard.test.ts`
- Create: `apps/web/src/hooks/useBoard.ts`

- [ ] **Step 1: Criar `apps/web/src/hooks/useBoard.test.ts`**

```typescript
// apps/web/src/hooks/useBoard.test.ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBoard } from '@/hooks/useBoard'
import type { Board } from '@/types'

const mockBoard: Board = {
  id: 'board-1',
  title: 'Processo ABC',
  description: null,
  clientId: 'c1',
  organizationId: 'o1',
  isActive: true,
  client: { id: 'c1', name: 'Empresa ABC' },
  columns: [
    {
      id: 'col-1',
      title: 'Backlog',
      position: 0,
      isFinal: false,
      color: null,
      boardId: 'board-1',
      tasks: [
        {
          id: 't1',
          title: 'Tarefa 1',
          position: 0,
          columnId: 'col-1',
          priority: 'MEDIUM',
          status: 'OPEN',
          tags: [],
          creatorId: 'u1',
          assigneeId: null,
          dueDate: null,
          description: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'col-2',
      title: 'Concluído',
      position: 1,
      isFinal: true,
      color: null,
      boardId: 'board-1',
      tasks: [],
    },
  ],
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

it('returns board data from API', async () => {
  server.use(
    http.get('http://localhost:3000/boards/board-1', () => HttpResponse.json(mockBoard)),
  )

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })

  await waitFor(() => expect(result.current.board).toBeDefined())
  expect(result.current.board!.columns).toHaveLength(2)
  expect(result.current.board!.columns[0].tasks).toHaveLength(1)
})

it('reverts optimistic update on moveTask error', async () => {
  server.use(
    http.get('http://localhost:3000/boards/board-1', () => HttpResponse.json(mockBoard)),
    http.patch('http://localhost:3000/tasks/t1/move', () =>
      HttpResponse.json({ message: 'error' }, { status: 500 }),
    ),
  )

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })
  await waitFor(() => expect(result.current.board).toBeDefined())

  act(() => {
    result.current.moveTask({ taskId: 't1', columnId: 'col-2', position: 0 })
  })

  // After error, task should revert to col-1
  await waitFor(() => {
    const col1 = result.current.board?.columns.find((c) => c.id === 'col-1')
    expect(col1?.tasks.some((t) => t.id === 't1')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter web test src/hooks/useBoard.test.ts 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/hooks/useBoard'".

- [ ] **Step 3: Criar `apps/web/src/hooks/useBoard.ts`**

```typescript
// apps/web/src/hooks/useBoard.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Board } from '@/types'

export interface MoveTaskPayload {
  taskId: string
  columnId: string
  position: number
}

export function useBoard(boardId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api.get<Board>(`/boards/${boardId}`).then((r) => r.data),
    enabled: !!boardId,
  })

  const moveMutation = useMutation({
    mutationFn: ({ taskId, columnId, position }: MoveTaskPayload) =>
      api.patch(`/tasks/${taskId}/move`, { columnId, position }).then((r) => r.data),

    onMutate: async ({ taskId, columnId, position }) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] })
      const snapshot = queryClient.getQueryData<Board>(['board', boardId])

      if (snapshot) {
        const allTasks = snapshot.columns.flatMap((c) => c.tasks)
        const movingTask = allTasks.find((t) => t.id === taskId)

        if (movingTask) {
          queryClient.setQueryData<Board>(['board', boardId], {
            ...snapshot,
            columns: snapshot.columns.map((col) => ({
              ...col,
              tasks:
                col.id === columnId
                  ? [
                      ...col.tasks.filter((t) => t.id !== taskId),
                      { ...movingTask, columnId, position },
                    ]
                  : col.tasks.filter((t) => t.id !== taskId),
            })),
          })
        }
      }

      return { snapshot }
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(['board', boardId], ctx.snapshot)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    },
  })

  return {
    board: query.data,
    isLoading: query.isLoading,
    moveTask: moveMutation.mutate,
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter web test src/hooks/useBoard.test.ts --reporter=verbose 2>&1 | tail -10
```

Esperado: 2 testes PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/hooks/useBoard.ts apps/web/src/hooks/useBoard.test.ts
git -C /home/max/job/autohubs/tramita commit -m "feat: useBoard hook — fetch + moveTask optimistic update (TDD)"
```

---

## Task 7: TemplateEditor (TDD)

**Files:**
- Create: `apps/web/src/components/TemplateEditor.test.tsx`
- Create: `apps/web/src/components/TemplateEditor.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/TemplateEditor.test.tsx`**

```typescript
// apps/web/src/components/TemplateEditor.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TemplateEditor } from '@/components/TemplateEditor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('renders preview in real time when clicking preview button', async () => {
  server.use(
    http.get('http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Olá, {{clientName}}!', isDefault: true }),
    ),
    http.post(
      'http://localhost:3000/notifications/templates/preview',
      async ({ request }) => {
        const body = await request.json() as { body: string }
        return HttpResponse.json({
          rendered: body.body.replace('{{clientName}}', 'João Silva'),
        })
      },
    ),
  )

  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })

  // Wait for template to load
  await waitFor(() => screen.getByDisplayValue('Olá, {{clientName}}!'))

  await userEvent.click(screen.getByRole('button', { name: 'Prévia' }))

  await waitFor(() => {
    expect(screen.getByText(/João Silva/)).toBeInTheDocument()
  })
})

it('shows save button and submits PUT on click', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Template atual', isDefault: false }),
    ),
    http.put(
      'http://localhost:3000/notifications/templates/TASK_MOVED/WHATSAPP',
      async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ body: 'Template atual', event: 'TASK_MOVED', channel: 'WHATSAPP' })
      },
    ),
  )

  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })

  await waitFor(() => screen.getByDisplayValue('Template atual'))
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ body: 'Template atual' })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter web test src/components/TemplateEditor.test.tsx 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/components/TemplateEditor'".

- [ ] **Step 3: Criar `apps/web/src/components/TemplateEditor.tsx`**

```typescript
// apps/web/src/components/TemplateEditor.tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const TEMPLATE_VARS = [
  'clientName', 'orgName', 'taskTitle', 'fromColumn',
  'toColumn', 'dueDate', 'portalUrl', 'commentText', 'commentAuthorName',
]

interface Props {
  event: string
  channel: string
}

export function TemplateEditor({ event, channel }: Props) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['template', event, channel],
    queryFn: () =>
      api
        .get<{ body: string; subject?: string; isDefault: boolean }>(
          `/notifications/templates/${event}/${channel}`,
        )
        .then((r) => r.data),
  })

  useEffect(() => {
    if (data?.body) setBody(data.body)
  }, [data?.body])

  const previewMutation = useMutation({
    mutationFn: () =>
      api
        .post<{ rendered: string }>('/notifications/templates/preview', { event, channel, body })
        .then((r) => r.data),
    onSuccess: (data) => setPreview(data.rendered),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/notifications/templates/${event}/${channel}`, { body }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['template', event, channel] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {TEMPLATE_VARS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setBody((b) => b + `{{${v}}}`)}
            className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className="font-mono text-sm"
      />

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
        >
          Prévia
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Salvar
        </Button>
      </div>

      {preview && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm whitespace-pre-wrap">
          <p className="text-xs font-medium text-gray-500 mb-2">Preview:</p>
          {preview}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter web test src/components/TemplateEditor.test.tsx --reporter=verbose 2>&1 | tail -10
```

Esperado: 2 testes PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/TemplateEditor.tsx apps/web/src/components/TemplateEditor.test.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: TemplateEditor — preview em tempo real + salvar template (TDD)"
```

---

## Task 8: Board page (Kanban DnD)

**Files:**
- Modify: `apps/web/src/pages/app/Board.tsx` (substituir stub)

- [ ] **Step 1: Substituir o stub por implementação completa**

```typescript
// apps/web/src/pages/app/Board.tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowLeft } from 'lucide-react'
import { useBoard } from '@/hooks/useBoard'
import { TaskCard } from '@/components/TaskCard'
import { TaskModal } from '@/components/TaskModal'
import type { Task } from '@/types'

function SortableTaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onClick={onClick} />
    </div>
  )
}

export default function Board() {
  const { boardId } = useParams<{ boardId: string }>()
  const { board, isLoading, moveTask } = useBoard(boardId!)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over || !board) return

    const taskId = active.id as string
    // Find target column: either the column itself or the column containing the over task
    const targetColumn =
      board.columns.find((col) => col.id === over.id) ??
      board.columns.find((col) => col.tasks.some((t) => t.id === over.id))

    if (!targetColumn) return

    const currentColumn = board.columns.find((col) => col.tasks.some((t) => t.id === taskId))
    if (currentColumn?.id === targetColumn.id) return

    const position = targetColumn.tasks.length
    moveTask({ taskId, columnId: targetColumn.id, position })
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando board...</div>
  if (!board) return <div className="p-8 text-gray-500">Board não encontrado.</div>

  const allTasks = board.columns.flatMap((c) => c.tasks)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <Link to="/app/dashboard" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{board.title}</h1>
          <p className="text-sm text-gray-500">{board.client.name}</p>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 h-full">
            {board.columns.map((column) => (
              <div key={column.id} className="flex-shrink-0 w-64">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">{column.title}</h3>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                    {column.tasks.length}
                  </span>
                </div>
                <SortableContext
                  id={column.id}
                  items={column.tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2 min-h-[4rem] rounded-lg bg-gray-50 p-2">
                    {column.tasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setSelectedTask(task)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/app/Board.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: Board page — Kanban com DnD e optimistic update"
```

---

## Task 9: Dashboard + Clients + Users pages

**Files:**
- Modify: `apps/web/src/pages/app/Dashboard.tsx`
- Modify: `apps/web/src/pages/app/Clients.tsx`
- Modify: `apps/web/src/pages/app/Users.tsx`

- [ ] **Step 1: Implementar `apps/web/src/pages/app/Dashboard.tsx`**

```typescript
// apps/web/src/pages/app/Dashboard.tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Board } from '@/types'

interface BoardSummary extends Pick<Board, 'id' | 'title' | 'client' | 'columns'> {}

export default function Dashboard() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {boards.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>Nenhum board cadastrado ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => {
            const allTasks = board.columns?.flatMap((c) => c.tasks ?? []) ?? []
            const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
            const overdueTasks = allTasks.filter(
              (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE',
            ).length
            const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0

            return (
              <Link key={board.id} to={`/app/board/${board.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-base">{board.title}</CardTitle>
                    <p className="text-sm text-gray-500">{board.client?.name}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {overdueTasks > 0 && (
                      <p className="text-xs text-red-500 font-medium mt-2">
                        ⚠ {overdueTasks} tarefa{overdueTasks > 1 ? 's' : ''} vencida{overdueTasks > 1 ? 's' : ''}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implementar `apps/web/src/pages/app/Clients.tsx`**

```typescript
// apps/web/src/pages/app/Clients.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import type { Client } from '@/types'

export default function Clients() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', whatsapp: '' })

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/clients', form).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '', whatsapp: '' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : 'Novo cliente'}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Senha (portal)</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="5582999999999" className="mt-1" />
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              Cadastrar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {clients.map((client) => (
          <Card key={client.id}>
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{client.name}</p>
                <p className="text-xs text-gray-500">{client.email}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(client.id)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                Desativar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implementar `apps/web/src/pages/app/Users.tsx`**

```typescript
// apps/web/src/pages/app/Users.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import type { User } from '@/types'

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Admin',
  ORG_MANAGER: 'Gerente',
  ORG_MEMBER: 'Colaborador',
}

export default function Users() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'ORG_MEMBER' as const })

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/users', form).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ name: '', email: '', password: '', role: 'ORG_MEMBER' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Usuários</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : 'Novo usuário'}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Senha</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Perfil</Label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
                className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
              >
                <option value="ORG_MEMBER">Colaborador</option>
                <option value="ORG_MANAGER">Gerente</option>
              </select>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              Cadastrar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.id}>
            <CardContent className="py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{user.email} · {ROLE_LABEL[user.role] ?? user.role}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(user.id)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
              >
                Desativar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/app/Dashboard.tsx apps/web/src/pages/app/Clients.tsx apps/web/src/pages/app/Users.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: Dashboard + Clients + Users pages"
```

---

## Task 10: Settings pages (Templates, Notifications, Subscription)

**Files:**
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`
- Modify: `apps/web/src/pages/app/settings/Subscription.tsx`

- [ ] **Step 1: Implementar `apps/web/src/pages/app/settings/Templates.tsx`**

```typescript
// apps/web/src/pages/app/settings/Templates.tsx
import { useState } from 'react'
import { TemplateEditor } from '@/components/TemplateEditor'

const EVENTS = ['TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_DUE_DATE_APPROACHING'] as const
const CHANNELS = ['WHATSAPP', 'EMAIL'] as const

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
}

export default function Templates() {
  const [event, setEvent] = useState<string>('TASK_MOVED')
  const [channel, setChannel] = useState<string>('WHATSAPP')

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Templates de Mensagem</h1>

      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700">Evento</label>
          <select
            value={event}
            onChange={(e) => setEvent(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
          >
            {EVENTS.map((e) => (
              <option key={e} value={e}>{EVENT_LABEL[e]}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700">Canal</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <TemplateEditor event={event} channel={channel} />
    </div>
  )
}
```

- [ ] **Step 2: Implementar `apps/web/src/pages/app/settings/Notifications.tsx`**

```typescript
// apps/web/src/pages/app/settings/Notifications.tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Config {
  whatsappEnabled?: boolean
  emailEnabled?: boolean
  taskMoved?: boolean
  taskCompleted?: boolean
  commentAdded?: boolean
  dueDateAlert?: boolean
  maximizebotToken?: string
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  emailFrom?: string
}

interface NotificationLog {
  id: string
  event: string
  channel: string
  recipient: string
  status: 'SENT' | 'FAILED' | 'PENDING'
  createdAt: string
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Config>({})

  const { data: config } = useQuery<Config>({
    queryKey: ['notifications-config'],
    queryFn: () => api.get('/notifications/config').then((r) => r.data),
  })

  const { data: logs = [] } = useQuery<NotificationLog[]>({
    queryKey: ['notifications-logs'],
    queryFn: () => api.get('/notifications/logs').then((r) => r.data),
  })

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/notifications/config', form).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications-config'] }),
  })

  const STATUS_COLOR: Record<string, string> = {
    SENT: 'text-green-600',
    FAILED: 'text-red-600',
    PENDING: 'text-yellow-600',
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Configurações de Notificação</h1>

      <Card>
        <CardHeader><CardTitle>Eventos habilitados</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Tarefa movida" checked={form.taskMoved ?? false} onChange={(v) => setForm({ ...form, taskMoved: v })} />
          <Toggle label="Tarefa concluída" checked={form.taskCompleted ?? false} onChange={(v) => setForm({ ...form, taskCompleted: v })} />
          <Toggle label="Comentário adicionado" checked={form.commentAdded ?? false} onChange={(v) => setForm({ ...form, commentAdded: v })} />
          <Toggle label="Prazo se aproximando" checked={form.dueDateAlert ?? false} onChange={(v) => setForm({ ...form, dueDateAlert: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>WhatsApp (MaximizeBot)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Habilitar WhatsApp" checked={form.whatsappEnabled ?? false} onChange={(v) => setForm({ ...form, whatsappEnabled: v })} />
          <div>
            <Label>Bearer Token</Label>
            <Input
              type="password"
              value={form.maximizebotToken ?? ''}
              onChange={(e) => setForm({ ...form, maximizebotToken: e.target.value })}
              placeholder="Bearer <token>"
              className="mt-1"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>E-mail (SMTP)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Toggle label="Habilitar E-mail" checked={form.emailEnabled ?? false} onChange={(v) => setForm({ ...form, emailEnabled: v })} />
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Host SMTP</Label><Input value={form.smtpHost ?? ''} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} className="mt-1" /></div>
            <div><Label>Porta</Label><Input type="number" value={form.smtpPort ?? ''} onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })} className="mt-1" /></div>
            <div><Label>Usuário</Label><Input value={form.smtpUser ?? ''} onChange={(e) => setForm({ ...form, smtpUser: e.target.value })} className="mt-1" /></div>
            <div><Label>Remetente</Label><Input value={form.emailFrom ?? ''} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })} className="mt-1" /></div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Salvar configurações
      </Button>

      {/* Logs */}
      <Card>
        <CardHeader><CardTitle>Logs de notificação</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum log ainda.</p>
          ) : (
            <div className="space-y-1">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span className="text-gray-700">{log.event} · {log.channel} → {log.recipient}</span>
                  <span className={STATUS_COLOR[log.status]}>{log.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Implementar `apps/web/src/pages/app/settings/Subscription.tsx`**

```typescript
// apps/web/src/pages/app/settings/Subscription.tsx
// Reutiliza a lógica existente de src/pages/org/Subscription.tsx
export { default } from '@/pages/org/Subscription'
```

**Nota:** A página `src/pages/org/Subscription.tsx` já foi criada na Fase 3 com status + histórico + troca de plano. Re-exportar evita duplicação.

- [ ] **Step 4: Verificar build completo**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/app/settings/
git -C /home/max/job/autohubs/tramita commit -m "feat: páginas de settings — Templates, Notifications, Subscription"
```

---

## Task 11: Full test suite + TASKS.md

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Rodar todos os testes do web**

```bash
pnpm --filter web test --reporter=verbose 2>&1 | tail -20
```

Esperado: 4 arquivos de teste, todos PASS:
- `TaskCard.test.tsx` — 4 testes
- `TaskModal.test.tsx` — 2 testes
- `TemplateEditor.test.tsx` — 2 testes
- `useBoard.test.ts` — 2 testes

- [ ] **Step 2: Rodar testes da API para confirmar sem regressão**

```bash
pnpm --filter api test 2>&1 | tail -5
```

Esperado: 107 testes PASS.

- [ ] **Step 3: Atualizar TASKS.md — marcar Fase 6 como concluída**

Abrir `docs/TASKS.md` e substituir a seção da Fase 6:

```markdown
## Fase 6 — Frontend Interno (Painel do Escritório) ✅
### Testes da Fase 6
- [x] `TaskCard.test.tsx` — renderiza prioridade, prazo vencido, badge correto
- [x] `TaskModal.test.tsx` — submit de edição chama PATCH com payload correto
- [x] `TemplateEditor.test.tsx` — preview renderiza variáveis em tempo real
- [x] `useBoard.test.ts` — hook retorna dados corretos, optimistic update reverte em erro
- [x] Setup React 19 + Vite + TailwindCSS v4 + shadcn/ui
- [x] Axios interceptors (refresh automático de token)
- [x] Tela de login única em `/login` — redireciona por role após autenticação
- [x] Guard de rota: acesso fora do próprio role → redirect `/login`
- [x] Dashboard: boards por cliente, indicador de progresso, alertas de vencimento
- [x] Board Kanban com `@dnd-kit/core`
  - [x] Drag entre colunas com optimistic update
  - [x] Modal de tarefa: edição inline, prioridade
  - [x] Badge de prioridade colorido
  - [x] Destaque visual em tarefas vencidas
- [x] Tela de clientes: lista com botão de criação e desativação
- [x] Tela de usuários: CRUD com roles
- [x] Tela de templates (`/app/settings/templates`)
  - [x] Seletor de evento + canal
  - [x] Editor de template com variáveis disponíveis listadas
  - [x] Botão "Prévia" — renderiza com dados fictícios em tempo real
  - [x] Botão "Salvar" — persiste template customizado
- [x] Tela de notificações: configurações + logs com status e mensagem enviada
- [x] Tela de assinatura: plano atual, próxima cobrança, histórico, troca de plano
```

- [ ] **Step 4: Commit final**

```bash
git -C /home/max/job/autohubs/tramita add docs/TASKS.md
git -C /home/max/job/autohubs/tramita commit -m "docs: marca Fase 6 como concluída no TASKS.md"
```

- [ ] **Step 5: Push**

```bash
git -C /home/max/job/autohubs/tramita push origin main
```
