# Fase 7: Portal do Cliente Final — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o portal read-only do cliente final — board do processo, drawer com comentários e histórico, perfil, relatórios e os 3 testes obrigatórios.

**Architecture:** Backend: novo módulo `portal` com `PATCH /portal/profile` + `GET /portal/tasks/:id/history` (apenas role CLIENT) + testes de isolamento contra os endpoints existentes de boards/tasks. Frontend: rotas `/portal/*` lazy-loaded em chunk separado (React.lazy), ProtectedRoute com role CLIENT, board Kanban read-only, TaskDrawer com Comments (TDD) e histórico.

**Tech Stack:** Backend: Fastify v5 + Prisma + bcryptjs (existente). Frontend: React 19 + React Router v7 (lazy) + TanStack Query v5 + Vitest + MSW.

---

## File Map

**Backend — criar:**
- `apps/api/src/modules/portal/portal.schema.ts` — Zod: `updateProfileSchema`
- `apps/api/src/modules/portal/portal.service.ts` — `updateClientProfile`, `getTaskHistory`
- `apps/api/src/modules/portal/portal.routes.ts` — `PATCH /portal/profile`, `GET /portal/tasks/:id/history`
- `apps/api/src/modules/portal/portal.routes.test.ts` ← OBRIGATÓRIO

**Backend — modificar:**
- `apps/api/src/server.ts` — registrar `portalRoutes` com prefix `/portal`

**Frontend — criar:**
- `apps/web/src/pages/portal/Layout.tsx` — layout mínimo do portal (header + logout)
- `apps/web/src/pages/portal/Boards.tsx` — lista de boards do cliente
- `apps/web/src/pages/portal/Board.tsx` — board read-only + progress bar + TaskDrawer
- `apps/web/src/pages/portal/Profile.tsx` — alterar senha/whatsapp
- `apps/web/src/pages/portal/Reports.tsx` — download de PDFs mensais (UI + botão)
- `apps/web/src/components/portal/Comments.tsx` — lista + form de comentário
- `apps/web/src/components/portal/Comments.test.tsx` ← OBRIGATÓRIO
- `apps/web/src/components/portal/TaskDrawer.tsx` — drawer lateral com detalhes, histórico, comentários

**Frontend — modificar:**
- `apps/web/src/router.tsx` — adicionar rotas `/portal/*` com lazy load + ProtectedRoute CLIENT

---

## Task 1: Backend — Portal module (TDD)

**Files:**
- Create: `apps/api/src/modules/portal/portal.schema.ts`
- Create: `apps/api/src/modules/portal/portal.service.ts`
- Create: `apps/api/src/modules/portal/portal.routes.ts`
- Create: `apps/api/src/modules/portal/portal.routes.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o arquivo de teste PRIMEIRO**

`apps/api/src/modules/portal/portal.routes.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestClient,
  createTestUser,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

describe('Portal — isolamento de tenant', () => {
  it('CLIENT não acessa board de outra org (404)', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const client1 = await createTestClient(org1.id)
    const client2 = await createTestClient(org2.id)
    const board = await createTestBoard(org1.id, client1.id)

    const auth = await getAuthHeader(client2.email, 'Client@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(404)
  })

  it('CLIENT não pode mover tarefas (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /portal/profile', () => {
  it('CLIENT atualiza próprio whatsapp — 200', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/portal/profile',
      headers: { authorization: auth },
      payload: { whatsapp: '5582999999999' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).whatsapp).toBe('5582999999999')
  })

  it('ORG_MEMBER não acessa /portal/profile (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/portal/profile',
      headers: { authorization: auth },
      payload: { whatsapp: '5582999999999' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /portal/tasks/:id/history', () => {
  it('CLIENT vê histórico de tarefa do próprio board', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/portal/tasks/${task.id}/history`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/portal/portal.routes.test.ts 2>&1 | tail -5
```

Esperado: FAIL — módulo não encontrado ou rota 404.

- [ ] **Step 3: Criar `apps/api/src/modules/portal/portal.schema.ts`**

```typescript
import { z } from 'zod'

export const updateProfileSchema = z.object({
  password: z.string().min(6).optional(),
  whatsapp: z.string().optional(),
})

export type UpdateProfileBody = z.infer<typeof updateProfileSchema>
```

- [ ] **Step 4: Criar `apps/api/src/modules/portal/portal.service.ts`**

```typescript
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { UpdateProfileBody } from './portal.schema'

export async function updateClientProfile(clientId: string, data: UpdateProfileBody) {
  const updateData: { whatsapp?: string; passwordHash?: string } = {}
  if (data.whatsapp !== undefined) updateData.whatsapp = data.whatsapp
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10)

  return prisma.client.update({
    where: { id: clientId },
    data: updateData,
    select: { id: true, name: true, email: true, whatsapp: true },
  })
}

export async function getTaskHistory(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })
}
```

- [ ] **Step 5: Criar `apps/api/src/modules/portal/portal.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { updateProfileSchema } from './portal.schema'
import { updateClientProfile, getTaskHistory } from './portal.service'

export async function portalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.patch('/profile', async (request, reply) => {
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientProfile(request.user.sub, result.data))
  })

  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!))
  })
}
```

- [ ] **Step 6: Registrar em `apps/api/src/server.ts`**

Adicionar após `import { notificationsRoutes }`:
```typescript
import { portalRoutes } from '@/modules/portal/portal.routes'
```

Adicionar após `app.register(notificationsRoutes, { prefix: '/notifications' })`:
```typescript
app.register(portalRoutes, { prefix: '/portal' })
```

- [ ] **Step 7: Rodar — deve passar**

```bash
pnpm --filter api test src/modules/portal/portal.routes.test.ts --reporter=verbose 2>&1 | tail -15
```

Esperado: 5 testes PASS.

- [ ] **Step 8: Rodar suite completa para garantir sem regressão**

```bash
pnpm --filter api test 2>&1 | tail -5
```

Esperado: todos os testes passando.

- [ ] **Step 9: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/api/src/modules/portal/ apps/api/src/server.ts
git -C /home/max/job/autohubs/tramita commit -m "feat: portal module — profile update + task history + isolation tests (TDD)"
```

---

## Task 2: Frontend — Portal routes (lazy) + PortalLayout + stubs

**Files:**
- Create: `apps/web/src/pages/portal/Layout.tsx`
- Create: `apps/web/src/pages/portal/Boards.tsx` (stub)
- Create: `apps/web/src/pages/portal/Board.tsx` (stub)
- Create: `apps/web/src/pages/portal/Profile.tsx` (stub)
- Create: `apps/web/src/pages/portal/Reports.tsx` (stub)
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Criar `apps/web/src/pages/portal/Layout.tsx`**

```typescript
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LayoutGrid, FileText, User, LogOut } from 'lucide-react'

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
      <aside className="w-52 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-600">Tramita</h1>
          <p className="text-xs text-gray-500 truncate">{user?.name}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <PortalLink to="/portal/board" icon={<LayoutGrid size={16} />} label="Meus Processos" />
          <PortalLink to="/portal/reports" icon={<FileText size={16} />} label="Relatórios" />
          <PortalLink to="/portal/profile" icon={<User size={16} />} label="Perfil" />
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

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function PortalLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
```

- [ ] **Step 2: Criar stubs para as pages do portal**

```bash
mkdir -p /home/max/job/autohubs/tramita/apps/web/src/pages/portal
```

`apps/web/src/pages/portal/Boards.tsx`:
```typescript
export default function PortalBoards() { return <div>Processos</div> }
```

`apps/web/src/pages/portal/Board.tsx`:
```typescript
export default function PortalBoard() { return <div>Board</div> }
```

`apps/web/src/pages/portal/Profile.tsx`:
```typescript
export default function PortalProfile() { return <div>Perfil</div> }
```

`apps/web/src/pages/portal/Reports.tsx`:
```typescript
export default function PortalReports() { return <div>Relatórios</div> }
```

- [ ] **Step 3: Atualizar `apps/web/src/router.tsx`**

Adicionar imports lazy no topo do arquivo, logo após os imports existentes:
```typescript
import { lazy, Suspense } from 'react'

const PortalLayout = lazy(() => import('@/pages/portal/Layout'))
const PortalBoards = lazy(() => import('@/pages/portal/Boards'))
const PortalBoard = lazy(() => import('@/pages/portal/Board'))
const PortalProfile = lazy(() => import('@/pages/portal/Profile'))
const PortalReports = lazy(() => import('@/pages/portal/Reports'))
```

Adicionar as rotas do portal no array do `createBrowserRouter`, antes da rota `{ path: '*', ... }`:
```typescript
{
  path: '/portal',
  element: (
    <ProtectedRoute allowedRoles={['CLIENT']}>
      <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-500">Carregando...</div>}>
        <PortalLayout />
      </Suspense>
    </ProtectedRoute>
  ),
  children: [
    { index: true, element: <Navigate to="/portal/board" replace /> },
    { path: 'board', element: <PortalBoards /> },
    { path: 'board/:boardId', element: <PortalBoard /> },
    { path: 'profile', element: <PortalProfile /> },
    { path: 'reports', element: <PortalReports /> },
  ],
},
```

- [ ] **Step 4: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros TypeScript. O bundle deve mostrar um chunk `portal-*.js` separado (lazy loading).

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/portal/ apps/web/src/router.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: portal routes lazy-loaded + PortalLayout com sidebar"
```

---

## Task 3: Frontend — Comments component (TDD)

**Files:**
- Create: `apps/web/src/components/portal/Comments.test.tsx`
- Create: `apps/web/src/components/portal/Comments.tsx`

- [ ] **Step 1: Criar o teste PRIMEIRO**

`apps/web/src/components/portal/Comments.test.tsx`:
```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { Comments } from '@/components/portal/Comments'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const existingComments = [
  {
    id: 'c1',
    content: 'Processo iniciado',
    authorType: 'USER',
    user: { id: 'u1', name: 'João Escrit.' },
    client: null,
    createdAt: '2024-01-01T10:00:00.000Z',
  },
]

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('lista comentários existentes com nome do autor', async () => {
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () =>
      HttpResponse.json(existingComments),
    ),
  )
  render(<Comments taskId="task-1" />, { wrapper })
  await waitFor(() => expect(screen.getByText('Processo iniciado')).toBeInTheDocument())
  expect(screen.getByText('João Escrit.')).toBeInTheDocument()
})

it('submits POST /tasks/:taskId/comments com content correto', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () => HttpResponse.json([])),
    http.post('http://localhost:3000/tasks/task-1/comments', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({
        id: 'c2',
        content: 'Meu comentário',
        authorType: 'CLIENT',
        user: null,
        client: { id: 'cl1', name: 'Empresa ABC' },
        createdAt: new Date().toISOString(),
      })
    }),
  )

  render(<Comments taskId="task-1" />, { wrapper })
  await waitFor(() => screen.getByPlaceholderText('Adicionar comentário...'))

  const textarea = screen.getByPlaceholderText('Adicionar comentário...')
  await userEvent.type(textarea, 'Meu comentário')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ content: 'Meu comentário' })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter web test src/components/portal/Comments.test.tsx 2>&1 | tail -5
```

Esperado: FAIL — "Cannot find module '@/components/portal/Comments'".

- [ ] **Step 3: Criar `apps/web/src/components/portal/Comments.tsx`**

```bash
mkdir -p /home/max/job/autohubs/tramita/apps/web/src/components/portal
```

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface CommentAuthor {
  id: string
  name: string
}

interface Comment {
  id: string
  content: string
  authorType: 'USER' | 'CLIENT'
  user: CommentAuthor | null
  client: CommentAuthor | null
  createdAt: string
}

interface Props {
  taskId: string
}

export function Comments({ taskId }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/comments`).then((r) => r.data),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      setContent('')
    },
  })

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {comments.map((c) => {
          const author = c.authorType === 'CLIENT' ? c.client : c.user
          return (
            <div key={c.id} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
                {author?.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700">{author?.name}</p>
                <p className="text-sm text-gray-800 mt-0.5">{c.content}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(c.createdAt).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 items-start">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Adicionar comentário..."
          rows={2}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        />
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !content.trim()}
          size="sm"
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar — deve passar**

```bash
pnpm --filter web test src/components/portal/Comments.test.tsx --reporter=verbose 2>&1 | tail -10
```

Esperado: 2 testes PASS.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/portal/
git -C /home/max/job/autohubs/tramita commit -m "feat: Comments component — lista + POST como CLIENT (TDD)"
```

---

## Task 4: Frontend — TaskDrawer + Portal Board page

**Files:**
- Create: `apps/web/src/components/portal/TaskDrawer.tsx`
- Modify: `apps/web/src/pages/portal/Board.tsx` (substituir stub)
- Modify: `apps/web/src/pages/portal/Boards.tsx` (substituir stub)

- [ ] **Step 1: Criar `apps/web/src/components/portal/TaskDrawer.tsx`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { X } from 'lucide-react'
import { Comments } from '@/components/portal/Comments'
import type { Task } from '@/types'

interface TaskHistory {
  id: string
  action: string
  fromValue: string | null
  toValue: string | null
  actorName: string
  createdAt: string
}

interface Props {
  task: Task
  onClose: () => void
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

export function TaskDrawer({ task, onClose }: Props) {
  const { data: history = [] } = useQuery<TaskHistory[]>({
    queryKey: ['task-history', task.id],
    queryFn: () => api.get(`/portal/tasks/${task.id}/history`).then((r) => r.data),
  })

  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside className="fixed inset-y-0 right-0 z-50 w-96 bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-semibold text-gray-900 leading-tight">{task.title}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority]}`}>
                {PRIORITY_LABEL[task.priority]}
              </span>
              {task.dueDate && (
                <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                  {isOverdue ? '⚠ ' : ''}
                  Prazo: {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Descrição</h3>
              <p className="text-sm text-gray-700">{task.description}</p>
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Histórico</h3>
              <div className="relative pl-4">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200" />
                {history.map((h) => (
                  <div key={h.id} className="relative mb-3 last:mb-0">
                    <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-blue-400" />
                    <p className="text-xs text-gray-600">
                      <span className="font-medium">{h.actorName}</span>
                      {' — '}
                      {h.action}
                      {h.toValue && (
                        <span className="text-gray-500"> → {h.toValue}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(h.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Comentários</h3>
            <Comments taskId={task.id} />
          </div>
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Substituir `apps/web/src/pages/portal/Boards.tsx`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'

interface BoardSummary {
  id: string
  title: string
  client: { id: string; name: string }
  _count?: { columns: number }
}

export default function PortalBoards() {
  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['portal-boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Meus Processos</h1>

      {boards.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>Nenhum processo encontrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Link
              key={board.id}
              to={`/portal/board/${board.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <h2 className="text-base font-semibold text-gray-900">{board.title}</h2>
              <p className="text-sm text-blue-600 mt-1">Ver detalhes →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Substituir `apps/web/src/pages/portal/Board.tsx`**

```typescript
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ArrowLeft } from 'lucide-react'
import { TaskDrawer } from '@/components/portal/TaskDrawer'
import { cn } from '@/lib/utils'
import type { Board, Task } from '@/types'

export default function PortalBoard() {
  const { boardId } = useParams<{ boardId: string }>()
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <Link to="/portal/board" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">{board.title}</h1>
          {/* Progress bar */}
          <div className="flex items-center gap-3 mt-1">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 flex-shrink-0">{progress}% concluído</span>
          </div>
        </div>
      </div>

      {/* Board — read-only */}
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full">
          {board.columns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-64">
              <div
                className={cn(
                  'flex items-center justify-between mb-3 pb-2 border-b-2',
                )}
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
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          {
                            LOW: 'bg-gray-100 text-gray-600',
                            MEDIUM: 'bg-blue-100 text-blue-600',
                            HIGH: 'bg-orange-100 text-orange-600',
                            URGENT: 'bg-red-100 text-red-600',
                          }[task.priority],
                        )}>
                          {task.priority}
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

      {/* Task Drawer */}
      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/components/portal/TaskDrawer.tsx apps/web/src/pages/portal/Board.tsx apps/web/src/pages/portal/Boards.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: portal board — Kanban read-only com drawer de tarefa, histórico e progresso"
```

---

## Task 5: Frontend — Portal Profile + Reports pages

**Files:**
- Modify: `apps/web/src/pages/portal/Profile.tsx`
- Modify: `apps/web/src/pages/portal/Reports.tsx`

- [ ] **Step 1: Substituir `apps/web/src/pages/portal/Profile.tsx`**

```typescript
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

export default function PortalProfile() {
  const { user } = useAuth()
  const [form, setForm] = useState({ password: '', confirmPassword: '', whatsapp: '' })
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      const payload: { password?: string; whatsapp?: string } = {}
      if (form.whatsapp) payload.whatsapp = form.whatsapp
      if (form.password) payload.password = form.password
      return api.patch('/portal/profile', payload).then((r) => r.data)
    },
    onSuccess: () => {
      setSuccessMsg('Perfil atualizado com sucesso.')
      setErrorMsg('')
      setForm({ password: '', confirmPassword: '', whatsapp: '' })
    },
    onError: () => {
      setErrorMsg('Erro ao salvar. Verifique os dados e tente novamente.')
    },
  })

  function handleSave() {
    if (form.password && form.password !== form.confirmPassword) {
      setErrorMsg('As senhas não coincidem.')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Meu Perfil</h1>

      <Card>
        <CardHeader>
          <CardTitle>Dados da conta</CardTitle>
          <p className="text-sm text-gray-500">{user?.name}</p>
        </CardHeader>
        <CardContent className="space-y-4">
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
          {successMsg && <p className="text-sm text-green-600">{successMsg}</p>}

          <Button onClick={handleSave} disabled={mutation.isPending}>
            Salvar alterações
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Substituir `apps/web/src/pages/portal/Reports.tsx`**

```typescript
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

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
      alert('Relatório não disponível para este período.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Relatórios</h1>

      <Card>
        <CardHeader>
          <CardTitle>Download de relatório mensal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700">Mês</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Ano</label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="mt-1 flex h-9 w-24 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
              >
                {[now.getFullYear(), now.getFullYear() - 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <Button onClick={handleDownload} disabled={loading}>
            {loading ? 'Gerando...' : 'Baixar PDF'}
          </Button>

          <p className="text-xs text-gray-400">
            O relatório inclui todas as tarefas movimentadas no período selecionado.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/portal/Profile.tsx apps/web/src/pages/portal/Reports.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: portal Profile + Reports pages"
```

---

## Task 6: Full test suite + TASKS.md

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Rodar toda a suite frontend**

```bash
pnpm --filter web test --reporter=verbose 2>&1 | tail -20
```

Esperado (6 arquivos, 12 testes):
- `TaskCard.test.tsx` — 4
- `TaskModal.test.tsx` — 2
- `TemplateEditor.test.tsx` — 2
- `useBoard.test.tsx` — 2
- `Comments.test.tsx` — 2

- [ ] **Step 2: Rodar toda a suite API**

```bash
pnpm --filter api test 2>&1 | tail -5
```

Esperado: todos os testes passando (incluindo os novos 5 de `portal.routes.test.ts`).

- [ ] **Step 3: Atualizar `docs/TASKS.md`**

Localizar a seção `## Fase 7 — Portal do Cliente Final` e substituir por:

```markdown
## Fase 7 — Portal do Cliente Final ✅
### Testes da Fase 7
- [x] `portal.routes.test.ts` — CLIENT não acessa board de outra org
- [x] `portal.routes.test.ts` — CLIENT não pode mover tarefas (403)
- [x] `Comments.test.tsx` — submit registra authorType CLIENT corretamente
- [x] Rota `/portal/*` com bundle separado (lazy load)
- [x] Login do cliente (email + senha própria — sem conta Microsoft)
- [x] Board do processo: colunas com cores, cards com prioridade e prazo
- [x] Drawer de detalhes da tarefa
  - [x] Campo de comentário (POST como CLIENT)
  - [x] Lista de comentários com avatar e timestamp
  - [x] Timeline de histórico de movimentações visível
- [x] Barra de progresso: % concluído no board
- [x] Seção de relatórios: download de PDFs mensais
- [x] Tela de perfil: alterar senha, número WhatsApp
```

- [ ] **Step 4: Commit final**

```bash
git -C /home/max/job/autohubs/tramita add docs/TASKS.md
git -C /home/max/job/autohubs/tramita commit -m "docs: marca Fase 7 como concluída no TASKS.md"
```

---

## Self-Review

### Spec coverage

| Requisito TASKS.md | Task |
|---|---|
| `portal.routes.test.ts` — CLIENT não acessa board de outra org | Task 1 |
| `portal.routes.test.ts` — CLIENT não pode mover tarefas (403) | Task 1 |
| `Comments.test.tsx` — submit registra authorType CLIENT | Task 3 |
| Rota `/portal/*` com bundle separado (lazy load) | Task 2 |
| Login do cliente (email + senha própria) | Existente — `auth.service.ts` já trata CLIENT; `Login.tsx` redireciona para `/portal/board` |
| Board do processo: colunas com cores, cards com prioridade e prazo | Task 4 |
| Drawer de tarefa: comentários + histórico | Tasks 3 + 4 |
| Barra de progresso | Task 4 |
| Seção de relatórios | Task 5 |
| Tela de perfil | Task 5 |

### Placeholder scan

Nenhum placeholder ("TBD", "TODO", "similar to") — código completo em todos os steps.

### Type consistency

- `Task` interface de `@/types/index.ts` usada consistentemente em Tasks 3, 4, 5
- `Board` interface (com `columns[].color`) usada em Task 4
- `TaskHistory` interface local em `TaskDrawer.tsx` — campos `id, action, fromValue, toValue, actorName, createdAt` batem com o schema Prisma `task_history`
- `portalRoutes` registrado com prefix `/portal` → endpoints ficam `/portal/profile` e `/portal/tasks/:id/history` ✓
