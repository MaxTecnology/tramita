# Spec — Fase 6: Frontend Interno (Painel do Escritório)

**Data:** 2026-06-02  
**Escopo:** Setup completo do `apps/web` para o painel interno dos escritórios contábeis (roles ORG_*): Vitest + jsdom + @testing-library/react, TailwindCSS v4, shadcn/ui, @dnd-kit, route guards, layout com sidebar, dashboard, Kanban com DnD + optimistic update, telas de clientes, usuários, templates de notificação, configurações e assinatura. 4 testes obrigatórios.

---

## Contexto

### O que já existe em `apps/web`
- React 19 + React Router v7 + TanStack Query v5 + axios (instalados)
- `src/lib/api.ts` — axios instance com interceptor de refresh token ✓
- `src/hooks/useAuth.ts` — lê user/tokens do localStorage ✓
- `src/pages/Login.tsx`, `src/pages/Register.tsx` ✓
- `src/pages/master/` — Dashboard, Plans, Organizations, Layout ✓
- `src/pages/org/Subscription.tsx` ✓
- `src/router.tsx` — rotas `/login`, `/register`, `/master/*`, `/org/subscription` ✓
- Vitest instalado mas **sem** configuração de ambiente (falta jsdom, @testing-library)
- TailwindCSS, shadcn/ui, @dnd-kit **não instalados**

### Rotas a criar (Fase 6)
Todas sob `/app/*` — acessíveis apenas para `ORG_ADMIN`, `ORG_MANAGER`, `ORG_MEMBER` (com restrições por sub-rota).

---

## Dependências a instalar

```bash
# TailwindCSS v4 (plugin Vite — sem tailwind.config.js)
pnpm --filter web add -D tailwindcss @tailwindcss/vite

# shadcn/ui (base: class-variance-authority, clsx, tailwind-merge, lucide-react, radix-ui)
pnpm --filter web add class-variance-authority clsx tailwind-merge lucide-react
pnpm --filter web add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-label @radix-ui/react-badge

# DnD Kit
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Testes
pnpm --filter web add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom msw
```

---

## Setup TailwindCSS v4

`vite.config.ts` — adicionar plugin:
```typescript
import tailwindcss from '@tailwindcss/vite'
// plugins: [react(), tailwindcss()]
```

`src/index.css`:
```css
@import "tailwindcss";
```

---

## Setup Vitest

`vite.config.ts` — adicionar bloco `test`:
```typescript
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./src/test/setup.ts'],
}
```

`src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`src/test/server.ts` — MSW server para testes:
```typescript
import { setupServer } from 'msw/node'
export const server = setupServer()
```

---

## Estrutura de arquivos novos

```
apps/web/src/
  components/
    ui/                        ← shadcn/ui primitivos (Button, Card, Dialog, etc.)
    TaskCard.tsx               ← badge de prioridade + destaque de prazo vencido
    TaskCard.test.tsx          ← TESTE OBRIGATÓRIO
    TaskModal.tsx              ← dialog de edição da tarefa
    TaskModal.test.tsx         ← TESTE OBRIGATÓRIO
    TemplateEditor.tsx         ← editor + preview + botão testar
    TemplateEditor.test.tsx    ← TESTE OBRIGATÓRIO
    ProtectedRoute.tsx         ← guard de rota por role
    AppLayout.tsx              ← sidebar + header para /app/*
  hooks/
    useBoard.ts                ← TanStack Query: fetch + moveTask mutation
    useBoard.test.ts           ← TESTE OBRIGATÓRIO
  pages/
    app/
      Dashboard.tsx            ← boards por cliente + indicadores + alertas de prazo
      Board.tsx                ← Kanban com DnD
      Clients.tsx              ← lista de clientes + contagem de processos
      Users.tsx                ← CRUD usuários internos
      settings/
        Templates.tsx          ← usa TemplateEditor
        Notifications.tsx      ← config MaximizeBot/SMTP + logs
        Subscription.tsx       ← plano atual + histórico + troca de plano
  test/
    setup.ts                   ← jest-dom + MSW server lifecycle
    server.ts                  ← MSW setupServer()
```

---

## `ProtectedRoute`

```typescript
// src/components/ProtectedRoute.tsx
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

---

## `AppLayout`

Sidebar fixa com links de navegação baseados no role. Header com nome do usuário e botão de logout.

Links exibidos por role mínimo:
- **Dashboard** — ORG_MEMBER+
- **Clientes** — ORG_MANAGER+
- **Usuários** — ORG_ADMIN
- **Templates** — ORG_ADMIN
- **Notificações** — ORG_ADMIN
- **Assinatura** — ORG_ADMIN

---

## `router.tsx` — adições

```typescript
// Adicionar às rotas existentes:
{
  path: '/app',
  element: <ProtectedRoute allowedRoles={['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER']}><AppLayout /></ProtectedRoute>,
  children: [
    { index: true, element: <Navigate to="/app/dashboard" replace /> },
    { path: 'dashboard', element: <Dashboard /> },
    { path: 'board/:boardId', element: <Board /> },
    { path: 'clients', element: <ProtectedRoute allowedRoles={['ORG_ADMIN', 'ORG_MANAGER']}><Clients /></ProtectedRoute> },
    { path: 'users', element: <ProtectedRoute allowedRoles={['ORG_ADMIN']}><Users /></ProtectedRoute> },
    { path: 'settings/templates', element: <ProtectedRoute allowedRoles={['ORG_ADMIN']}><Templates /></ProtectedRoute> },
    { path: 'settings/notifications', element: <ProtectedRoute allowedRoles={['ORG_ADMIN']}><Notifications /></ProtectedRoute> },
    { path: 'settings/subscription', element: <ProtectedRoute allowedRoles={['ORG_ADMIN']}><AppSubscription /></ProtectedRoute> },
  ],
}
```

Atualizar o redirect pós-login na `Login.tsx` por role:
```typescript
const redirectMap: Record<string, string> = {
  MASTER: '/master/dashboard',
  ORG_ADMIN: '/app/dashboard',
  ORG_MANAGER: '/app/dashboard',
  ORG_MEMBER: '/app/dashboard',
  CLIENT: '/portal/board',  // Fase 7
}
```

---

## `TaskCard`

Props: `task: Task`, `onClick: () => void`

- Badge de prioridade: `LOW` → cinza, `MEDIUM` → azul, `HIGH` → laranja, `URGENT` → vermelho
- Se `dueDate < now` e `status !== 'DONE'`: borda ou fundo vermelho claro (`border-red-400`)
- Exibe: título, assignee (avatar/iniciais), badge de prioridade, ícone de prazo se vencido

---

## `TaskModal`

Dialog do Radix UI. Campos editáveis:
- título (Input)
- descrição (Textarea)
- prioridade (Select)
- assigneeId (Select com lista de usuários da org)
- dueDate (Input type="date")
- tags (Input com chips)

Submit: `PATCH /tasks/:id` via TanStack Query `useMutation`. Fecha ao confirmar.

---

## `useBoard(boardId: string)`

```typescript
export function useBoard(boardId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api.get(`/boards/${boardId}`).then(r => r.data),
  })

  const moveMutation = useMutation({
    mutationFn: ({ taskId, columnId, position }: MoveTaskPayload) =>
      api.patch(`/tasks/${taskId}/move`, { columnId, position }).then(r => r.data),

    onMutate: async ({ taskId, columnId, position }) => {
      await queryClient.cancelQueries({ queryKey: ['board', boardId] })
      const snapshot = queryClient.getQueryData(['board', boardId])
      queryClient.setQueryData(['board', boardId], (old: Board) => ({
        ...old,
        columns: old.columns.map(col => ({
          ...col,
          tasks: col.id === columnId
            ? [...col.tasks.filter(t => t.id !== taskId), { ...old.columns.flatMap(c => c.tasks).find(t => t.id === taskId)!, position }]
            : col.tasks.filter(t => t.id !== taskId),
        })),
      }))
      return { snapshot }
    },

    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(['board', boardId], ctx?.snapshot)
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['board', boardId] })
    },
  })

  return { board: query.data, isLoading: query.isLoading, moveTask: moveMutation.mutate }
}
```

---

## `Board.tsx` — Kanban DnD

Usa `DndContext` do @dnd-kit com `sensors` de pointer e keyboard. Cada coluna é um `SortableContext`. Ao `onDragEnd`: calcula `columnId` destino e `position` pelo índice, chama `moveTask`.

---

## `TemplateEditor`

Props: `event: NotificationEvent`, `channel: MessageChannel`

1. Busca template atual via `GET /notifications/templates/:event/:channel`
2. Exibe textarea com template body (editável)
3. Lista variáveis disponíveis como chips clicáveis (insere `{{var}}` no cursor)
4. Botão "Prévia": chama `POST /notifications/templates/preview` com body atual → exibe resultado
5. Botão "Testar": abre dialog pedindo número/email → chama `POST /notifications/config/test-whatsapp` ou `test-email`
6. Botão "Salvar": `PUT /notifications/templates/:event/:channel`

---

## Testes obrigatórios

### `TaskCard.test.tsx`

```typescript
import { render, screen } from '@testing-library/react'
import { TaskCard } from '@/components/TaskCard'

const baseTask = {
  id: '1', title: 'Abertura LTDA', priority: 'HIGH',
  status: 'OPEN', position: 0, columnId: 'col1', tags: [],
  creatorId: 'u1', dueDate: null, description: null, assigneeId: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

it('renders priority badge with correct color class for HIGH', () => {
  render(<TaskCard task={baseTask} onClick={() => {}} />)
  const badge = screen.getByText('HIGH')
  expect(badge).toHaveClass('bg-orange-100')
})

it('highlights overdue task when dueDate is in the past and status is not DONE', () => {
  const overdueTask = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z' }
  const { container } = render(<TaskCard task={overdueTask} onClick={() => {}} />)
  expect(container.firstChild).toHaveClass('border-red-400')
})

it('does not highlight completed task even if dueDate is in the past', () => {
  const doneTask = { ...baseTask, dueDate: '2020-01-01T00:00:00.000Z', status: 'DONE' }
  const { container } = render(<TaskCard task={doneTask} onClick={() => {}} />)
  expect(container.firstChild).not.toHaveClass('border-red-400')
})
```

### `TaskModal.test.tsx`

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TaskModal } from '@/components/TaskModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const task = {
  id: 'task-1', title: 'Tarefa teste', priority: 'MEDIUM', status: 'OPEN',
  description: '', assigneeId: null, dueDate: null, tags: [], position: 0,
  columnId: 'col1', creatorId: 'u1',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

it('submits PATCH /tasks/:id with correct payload on save', async () => {
  let capturedBody: unknown
  server.use(
    http.patch('/tasks/task-1', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({ ...task, title: 'Novo título' })
    }),
    http.get('/users', () => HttpResponse.json([])),
  )

  render(<TaskModal task={task} open onClose={() => {}} />, { wrapper })

  await userEvent.clear(screen.getByLabelText('Título'))
  await userEvent.type(screen.getByLabelText('Título'), 'Novo título')
  await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ title: 'Novo título' })
  })
})
```

### `TemplateEditor.test.tsx`

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { TemplateEditor } from '@/components/TemplateEditor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

it('renders preview in real time when clicking preview button', async () => {
  server.use(
    http.get('/notifications/templates/TASK_MOVED/WHATSAPP', () =>
      HttpResponse.json({ body: 'Olá, {{clientName}}!', isDefault: true }),
    ),
    http.post('/notifications/templates/preview', async ({ request }) => {
      const body = await request.json() as { body: string }
      return HttpResponse.json({ rendered: body.body.replace('{{clientName}}', 'João Silva') })
    }),
  )

  render(<TemplateEditor event="TASK_MOVED" channel="WHATSAPP" />, { wrapper })

  await waitFor(() => screen.getByDisplayValue('Olá, {{clientName}}!'))
  await userEvent.click(screen.getByRole('button', { name: 'Prévia' }))

  await waitFor(() => {
    expect(screen.getByText('João Silva')).toBeInTheDocument()
  })
})
```

### `useBoard.test.ts`

```typescript
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBoard } from '@/hooks/useBoard'

const mockBoard = {
  id: 'board-1', title: 'Processo ABC', clientId: 'c1', organizationId: 'o1',
  columns: [
    { id: 'col-1', title: 'Backlog', position: 0, isFinal: false, tasks: [
      { id: 't1', title: 'Tarefa 1', position: 0, columnId: 'col-1', priority: 'MEDIUM', status: 'OPEN', tags: [], creatorId: 'u1', assigneeId: null, dueDate: null, description: null },
    ]},
    { id: 'col-2', title: 'Concluído', position: 1, isFinal: true, tasks: [] },
  ],
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

it('returns board data from API', async () => {
  server.use(http.get('/boards/board-1', () => HttpResponse.json(mockBoard)))

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })

  await waitFor(() => expect(result.current.board).toBeDefined())
  expect(result.current.board.columns).toHaveLength(2)
})

it('reverts optimistic update on moveTask error', async () => {
  server.use(
    http.get('/boards/board-1', () => HttpResponse.json(mockBoard)),
    http.patch('/tasks/t1/move', () => HttpResponse.json({ message: 'erro' }, { status: 500 })),
  )

  const { result } = renderHook(() => useBoard('board-1'), { wrapper })
  await waitFor(() => expect(result.current.board).toBeDefined())

  act(() => {
    result.current.moveTask({ taskId: 't1', columnId: 'col-2', position: 0 })
  })

  await waitFor(() => {
    const col1Tasks = result.current.board.columns.find(c => c.id === 'col-1')?.tasks
    expect(col1Tasks?.some(t => t.id === 't1')).toBe(true)
  })
})
```

---

## Páginas

### `Dashboard.tsx`
- `useQuery` para `GET /boards` — lista todos os boards da org
- Para cada board: exibe nome do cliente, progresso (% tarefas DONE), alertas de prazo vencido
- Clique no board → navega para `/app/board/:boardId`

### `Board.tsx`
- Usa `useBoard(boardId)` (parâmetro via `useParams`)
- `DndContext` com `onDragEnd` → chama `moveTask`
- Colunas renderizadas como `SortableContext`
- `TaskCard` clicável → abre `TaskModal`

### `Clients.tsx`
- `useQuery` para `GET /clients`
- Lista com nome, CNPJ, email, contador de boards ativos
- Botões: criar, editar, desativar

### `Users.tsx`
- `useQuery` para `GET /users`
- Lista com nome, email, role, status
- Formulário inline ou dialog para criar/editar (role: ORG_MANAGER ou ORG_MEMBER)

### `Templates.tsx`
- Seletor de evento (`NotificationEvent`) + canal (`MessageChannel`)
- Renderiza `<TemplateEditor event={event} channel={channel} />`

### `Notifications.tsx`
- Formulário `PATCH /notifications/config` (switches de eventos + campos SMTP/MaximizeBot)
- Tabela de logs `GET /notifications/logs` com filtros de status e canal

### `Subscription.tsx` (app)
- Reaproveitamento da lógica da `src/pages/org/Subscription.tsx` existente
- Status, próxima cobrança, histórico, botão de troca de plano

---

## Checklist de conclusão (critério da Fase 6)

- [ ] `pnpm --filter web test` verde (4 testes obrigatórios)
- [ ] `pnpm --filter web dev` sobe sem erros
- [ ] Login → redireciona corretamente por role
- [ ] ORG_MEMBER acessando `/app/users` → redirect para `/login`
- [ ] Drag de tarefa entre colunas funciona com optimistic update
- [ ] `TaskModal` edita tarefa e fecha ao salvar
- [ ] `TemplateEditor` exibe preview ao clicar "Prévia"
