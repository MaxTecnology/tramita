# Toast Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar feedback visual (toast) em todas as ações de mutação do sistema usando a biblioteca Sonner.

**Architecture:** Instalar Sonner, registrar `<Toaster />` uma vez em `App.tsx`, depois adicionar `import { toast } from 'sonner'` e chamar `toast.success()` / `toast.error()` nos callbacks `onSuccess`/`onError` de cada mutation. Nenhuma lógica de negócio é alterada.

**Tech Stack:** React 19, TanStack Query v5, Sonner (toast library — padrão shadcn/ui)

---

## Mapa de Arquivos

**Task 1 — Setup:**
- Modify: `apps/web/package.json` — instalar `sonner`
- Modify: `apps/web/src/App.tsx` — registrar `<Toaster />`

**Task 2 — Painel do escritório:**
- Modify: `apps/web/src/pages/app/Clients.tsx`
- Modify: `apps/web/src/pages/app/Users.tsx`
- Modify: `apps/web/src/pages/app/Processes.tsx`
- Modify: `apps/web/src/pages/app/Dashboard.tsx`
- Modify: `apps/web/src/pages/app/Board.tsx`
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`
- Modify: `apps/web/src/components/shared/Comments.tsx`
- Modify: `apps/web/src/components/TemplateEditor.tsx`
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`

**Task 3 — Master + portal:**
- Modify: `apps/web/src/pages/master/Plans.tsx`
- Modify: `apps/web/src/pages/master/Organizations.tsx`
- Modify: `apps/web/src/pages/org/Subscription.tsx`
- Modify: `apps/web/src/pages/portal/Profile.tsx`

---

## Task 1: Instalar Sonner e registrar o Toaster

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Modify: `apps/web/src/App.tsx`

- [ ] **Instalar Sonner**

```bash
cd /home/max/job/autohubs/tramita && /home/max/.local/bin/pnpm --filter web add sonner
```

Esperado: `sonner` adicionado em `apps/web/package.json` dependencies.

- [ ] **Registrar `<Toaster />` em `App.tsx`**

O arquivo atual é:
```tsx
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

Substituir por:
```tsx
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { queryClient } from '@/lib/queryClient'
import { router } from '@/router'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
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
git add apps/web/src/App.tsx apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "feat: instalar Sonner e registrar Toaster no App"
```

---

## Task 2: Toasts no painel do escritório

**Files:**
- Modify: `apps/web/src/pages/app/Clients.tsx`
- Modify: `apps/web/src/pages/app/Users.tsx`
- Modify: `apps/web/src/pages/app/Processes.tsx`
- Modify: `apps/web/src/pages/app/Dashboard.tsx`
- Modify: `apps/web/src/pages/app/Board.tsx`
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`
- Modify: `apps/web/src/components/shared/Comments.tsx`
- Modify: `apps/web/src/components/TemplateEditor.tsx`
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`

Padrão para todos os arquivos:
1. Adicionar `import { toast } from 'sonner'` após os outros imports
2. Adicionar `toast.success(...)` no `onSuccess` de cada mutation
3. Adicionar `onError: () => toast.error(...)` onde ainda não existe

- [ ] **Adicionar toasts em `Clients.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

Localizar `createMutation` e adicionar ao `onSuccess` (manter o que já existe, só acrescentar a chamada):
```typescript
    onSuccess: () => {
      toast.success('Cliente cadastrado com sucesso')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setShowCreate(false)
      setCreateForm(EMPTY_CREATE)
      setSearch('')
      setTypeFilter('all')
    },
    onError: () => toast.error('Erro ao cadastrar cliente'),
```

Localizar `updateMutation` e adicionar:
```typescript
    onSuccess: () => {
      toast.success('Cliente atualizado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setEditingClient(null)
    },
    onError: () => toast.error('Erro ao salvar alterações'),
```

Localizar `deleteMutation` e adicionar:
```typescript
    onSuccess: () => {
      toast.success('Cliente desativado')
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeletingId(null)
    },
    onError: () => toast.error('Erro ao desativar cliente'),
```

- [ ] **Adicionar toasts em `Users.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`createMutation`:
```typescript
    onSuccess: () => {
      toast.success('Usuário cadastrado com sucesso')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreate(false)
      setCreateForm(EMPTY_CREATE)
      setSearch('')
      setRoleFilter('all')
    },
    onError: () => toast.error('Erro ao cadastrar usuário'),
```

`updateMutation`:
```typescript
    onSuccess: () => {
      toast.success('Usuário atualizado')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
    },
    onError: () => toast.error('Erro ao salvar alterações'),
```

`deleteMutation`:
```typescript
    onSuccess: () => {
      toast.success('Usuário desativado')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeletingId(null)
    },
    onError: () => toast.error('Erro ao desativar usuário'),
```

- [ ] **Adicionar toasts em `Processes.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`createMutation` (o `navigate` já existe no onSuccess — só acrescentar o toast antes):
```typescript
    onSuccess: (board) => {
      toast.success('Processo criado com sucesso')
      qc.invalidateQueries({ queryKey: ['boards'] })
      setNewProcessOpen(false)
      setNewProcessForm({ title: '', clientId: '', dueDate: '' })
      navigate(`/app/board/${board.id}`)
    },
    onError: () => toast.error('Erro ao criar processo'),
```

- [ ] **Adicionar toasts em `Dashboard.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

Localizar a mutation de criação de processo (que tem `navigate` no onSuccess) e adicionar:
```typescript
    onSuccess: (board) => {
      toast.success('Processo criado com sucesso')
      // manter o resto do onSuccess existente intacto
    },
    onError: () => toast.error('Erro ao criar processo'),
```

- [ ] **Adicionar toasts em `Board.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

Localizar a mutation de criação de tarefa e adicionar:
```typescript
    onSuccess: () => {
      toast.success('Tarefa criada')
      queryClient.invalidateQueries({ queryKey: ['board'] })
    },
    onError: () => toast.error('Erro ao criar tarefa'),
```

- [ ] **Adicionar toasts em `TaskDrawer.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

Mutation de update da tarefa:
```typescript
    onSuccess: () => {
      toast.success('Tarefa atualizada')
      queryClient.invalidateQueries({ queryKey: ['board'] })
    },
    onError: () => toast.error('Erro ao salvar tarefa'),
```

Mutation de upload de anexo:
```typescript
    onSuccess: () => {
      toast.success('Arquivo anexado')
      queryClient.invalidateQueries({ queryKey: ['attachments', task.id] })
    },
    onError: () => toast.error('Erro ao anexar arquivo'),
```

Mutation de delete de anexo:
```typescript
    onSuccess: () => {
      toast.success('Anexo removido')
      queryClient.invalidateQueries({ queryKey: ['attachments', task.id] })
    },
    onError: () => toast.error('Erro ao remover anexo'),
```

- [ ] **Adicionar toasts em `Comments.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`createMutation`:
```typescript
    onSuccess: () => {
      toast.success('Comentário adicionado')
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
    },
    onError: () => toast.error('Erro ao adicionar comentário'),
```

`deleteMutation`:
```typescript
    onSuccess: () => {
      toast.success('Comentário removido')
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
    },
    onError: () => toast.error('Erro ao remover comentário'),
```

- [ ] **Adicionar toasts em `TemplateEditor.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`saveMutation`:
```typescript
    onSuccess: () => {
      toast.success('Template salvo')
      queryClient.invalidateQueries({ queryKey: ['template', event, channel] })
    },
    onError: () => toast.error('Erro ao salvar template'),
```

`previewMutation` — não recebe toast (resultado já aparece inline).

- [ ] **Adicionar toasts em `Notifications.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`saveMutation`:
```typescript
    onSuccess: () => {
      toast.success('Configurações salvas')
      queryClient.invalidateQueries({ queryKey: ['notifications-config'] })
    },
    onError: () => toast.error('Erro ao salvar configurações'),
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add \
  apps/web/src/pages/app/Clients.tsx \
  apps/web/src/pages/app/Users.tsx \
  apps/web/src/pages/app/Processes.tsx \
  apps/web/src/pages/app/Dashboard.tsx \
  apps/web/src/pages/app/Board.tsx \
  apps/web/src/components/shared/TaskDrawer.tsx \
  apps/web/src/components/shared/Comments.tsx \
  apps/web/src/components/TemplateEditor.tsx \
  apps/web/src/pages/app/settings/Notifications.tsx
git commit -m "feat: toasts de sucesso e erro no painel do escritório"
```

---

## Task 3: Toasts nas páginas master e portal

**Files:**
- Modify: `apps/web/src/pages/master/Plans.tsx`
- Modify: `apps/web/src/pages/master/Organizations.tsx`
- Modify: `apps/web/src/pages/org/Subscription.tsx`
- Modify: `apps/web/src/pages/portal/Profile.tsx`

- [ ] **Adicionar toasts em `Plans.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`createMutation`:
```typescript
    onSuccess: () => {
      toast.success('Plano criado')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      // manter o resto do onSuccess existente
    },
    onError: () => toast.error('Erro ao criar plano'),
```

`updateMutation`:
```typescript
    onSuccess: () => {
      toast.success('Plano atualizado')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
      // manter o resto do onSuccess existente
    },
    onError: () => toast.error('Erro ao atualizar plano'),
```

`deleteMutation`:
```typescript
    onSuccess: () => {
      toast.success('Plano removido')
      qc.invalidateQueries({ queryKey: ['master', 'plans'] })
    },
    onError: () => toast.error('Erro ao remover plano'),
```

- [ ] **Adicionar toasts em `Organizations.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`updateMutation`:
```typescript
    onSuccess: () => {
      toast.success('Escritório atualizado')
      qc.invalidateQueries({ queryKey: ['master', 'organizations'] })
    },
    onError: () => toast.error('Erro ao atualizar escritório'),
```

- [ ] **Adicionar toasts em `Subscription.tsx`**

Adicionar import:
```typescript
import { toast } from 'sonner'
```

`changePlanMutation`:
```typescript
    onSuccess: () => {
      toast.success('Plano alterado com sucesso')
      // manter o resto do onSuccess existente
    },
    onError: () => toast.error('Erro ao alterar plano'),
```

- [ ] **Adicionar toasts em `Profile.tsx` (portal)**

Ler o arquivo antes de editar — ele já tem `onSuccess` e `onError` com mensagens de estado. Substituir essas mensagens de estado por toasts.

Adicionar import:
```typescript
import { toast } from 'sonner'
```

Localizar a mutation e substituir os handlers:
```typescript
    onSuccess: () => {
      toast.success('Perfil atualizado')
      // remover qualquer setState de mensagem de sucesso existente
    },
    onError: () => {
      toast.error('Erro ao atualizar perfil')
      // remover qualquer setState de mensagem de erro existente
    },
```

Se houver estado local de mensagem (ex: `const [message, setMessage] = useState('')`) e JSX que renderiza essa mensagem, remover ambos — o toast substituiu essa responsabilidade.

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -5
```

Esperado: `✓ built in ...`

- [ ] **Commit**

```bash
git add \
  apps/web/src/pages/master/Plans.tsx \
  apps/web/src/pages/master/Organizations.tsx \
  apps/web/src/pages/org/Subscription.tsx \
  apps/web/src/pages/portal/Profile.tsx
git commit -m "feat: toasts de sucesso e erro nas páginas master e portal"
```

---

## Checklist Final de Validação

- [ ] `sonner` presente em `apps/web/package.json`
- [ ] `<Toaster richColors position="top-right" />` em `App.tsx`
- [ ] Criar cliente → toast verde "Cliente cadastrado com sucesso"
- [ ] Editar usuário → toast verde "Usuário atualizado"
- [ ] Desativar usuário → toast verde "Usuário desativado"
- [ ] Criar processo → toast verde "Processo criado com sucesso"
- [ ] Salvar template → toast verde "Template salvo"
- [ ] Salvar configurações de notificação → toast verde "Configurações salvas"
- [ ] Erros de rede simulados → toast vermelho com mensagem correspondente
- [ ] Build sem erros TypeScript
- [ ] Testes da API: 141 passando (nenhuma mudança no backend)
