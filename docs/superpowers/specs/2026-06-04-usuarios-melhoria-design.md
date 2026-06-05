# Usuários — Melhoria Completa — Design Spec

**Data:** 2026-06-04
**Escopo:** Reescrever `Users.tsx` com paridade de qualidade em relação a `Clients.tsx` — edição via modal, telefone no formulário, validação, erros inline, confirmação no delete, busca por texto e filtro por perfil.
**Motivação:** A tela de usuários não usa o endpoint `PATCH /users/:id` que já existe, não tem campos de validação, não tem busca e tem bugs de UX (loading compartilhado no delete, sem confirmação).

---

## Escopo

**Apenas frontend.** Zero mudanças no backend — todos os endpoints necessários já existem:
- `GET /users` — lista usuários ativos
- `POST /users` — cria usuário (name, email, password, role, phone)
- `PATCH /users/:id` — edita (name, email, role, phone)
- `DELETE /users/:id` — soft delete (isActive = false)

**Arquivos:**
- Modify: `apps/web/src/pages/app/Users.tsx` — reescrita completa
- `apps/web/src/types/index.ts` — sem mudança (interface `User` já está correta)

---

## Estados

```typescript
// Criação
showCreate: boolean
createForm: { name: string; email: string; password: string; role: 'ORG_MANAGER' | 'ORG_MEMBER'; phone: string }

// Edição
editingUser: User | null
editForm: { name: string; email: string; role: 'ORG_MANAGER' | 'ORG_MEMBER'; phone: string }

// Delete com loading por item
deletingId: string | null

// Filtros
search: string
roleFilter: 'all' | 'ORG_MANAGER' | 'ORG_MEMBER'
```

---

## Mutations

**`createMutation`**
- `POST /users` com todos os campos do `createForm`
- `phone` enviado como `phone || undefined` (campo opcional)
- `onSuccess`: invalida query `['users']`, fecha form, reseta `createForm`, reseta `search` e `roleFilter` para default
- Botão disabled quando `isPending || !createForm.name || !createForm.email || !createForm.password`

**`updateMutation`**
- Recebe `EditForm & { id: string }` — id capturado no clique, não via `editingUser!.id`
- `PATCH /users/:id` com name, email, role, phone (phone como `|| undefined`)
- `onSuccess`: invalida query, fecha modal

**`deleteMutation`**
- `DELETE /users/:id`
- `onSuccess`: invalida query, `setDeletingId(null)`
- Antes de disparar: `window.confirm(`Desativar o usuário "${user.name}"?`)`
- Loading/disabled: `deleteMutation.isPending && deletingId === user.id`

---

## Filtros (client-side)

```typescript
const filtered = useMemo(() => {
  const q = search.toLowerCase().trim()
  return users.filter((u) => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    const matchSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    return matchRole && matchSearch
  })
}, [users, search, roleFilter])
```

Barra de filtros:
```
[ 🔍 Buscar por nome ou e-mail... ] [ Todos | Gerente | Colaborador ]
```

Contador: mostra total quando sem filtro, "Exibindo X de Y" quando filtrado.

---

## Cards (estilo Clients.tsx — divs diretos, sem Card/CardContent)

```
┌─────────────────────────────────────────────────────┐
│ Nome do Usuário  [Gerente]                          │
│ email@example.com · (82) 99999-9999                 │
│                               [Editar] [Desativar]  │
└─────────────────────────────────────────────────────┘
```

- Badge de perfil: `Admin` (cinza), `Gerente` (azul claro), `Colaborador` (verde claro)
- Telefone exibido apenas quando preenchido (`user.phone && ...`)
- Botão "Desativar" com `window.confirm` + loading por item
- Botões "Editar" e "Desativar" **não exibidos para usuários `ORG_ADMIN`** — o `updateUserSchema` do backend só aceita `ORG_MANAGER | ORG_MEMBER`, e o admin não deve poder se remover. O MASTER gerencia ORG_ADMINs pelo painel master (rota separada), não por esta tela

---

## Modal de edição

`Dialog` shadcn (`sm:max-w-md`) com campos:
- Nome * (obrigatório)
- E-mail * (obrigatório)
- Perfil (select: Gerente / Colaborador) — ORG_ADMIN não é editável via este modal
- Telefone (opcional)

Sem campo de senha (troca de senha é fluxo separado, fora do escopo).

Botão "Salvar" disabled quando `isPending || !editForm.name || !editForm.email`.

---

## Formulário de criação

Campos: Nome *, E-mail *, Senha * (min 8 chars), Perfil (select), Telefone (opcional).

Mesmo padrão visual de Clients: inline abaixo do header, grid 2 colunas no sm.

---

## Estilo

Alinhado com `Clients.tsx`:
- Divs diretos com `bg-white rounded-lg border border-gray-200 px-4 py-3`
- Botão principal: `bg-[#185FA5] hover:bg-[#0C447C] text-white`
- Sem `Card`/`CardContent` do shadcn

---

## Sem testes novos

A lógica é puramente de UI state + mutations TanStack Query. Nenhuma lógica crítica de negócio a testar no frontend.

---

## Checklist de entrega

- [ ] `useMemo` importado
- [ ] Estados: `showCreate`, `createForm`, `editingUser`, `editForm`, `deletingId`, `search`, `roleFilter`
- [ ] `createMutation` com guards e reset de filtros no onSuccess
- [ ] `updateMutation` com id no payload (sem non-null assertion)
- [ ] `deleteMutation` com `deletingId`, `window.confirm` e loading por item
- [ ] `filtered` via `useMemo`
- [ ] Barra de filtros: input de busca + toggle Todos/Gerente/Colaborador
- [ ] Contador "X usuário(s)" / "Exibindo X de Y"
- [ ] Cards com divs diretos, badge de perfil colorido, telefone condicional
- [ ] Botões "Editar" e "Desativar" por card
- [ ] Modal de edição com Dialog shadcn
- [ ] Formulário de criação com phone
- [ ] Erros inline em criação e edição
- [ ] Build sem erros TypeScript
