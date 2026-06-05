# Clientes — Filtro e Busca — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar barra de filtros à página de Clientes com busca por texto, filtro de tipo PF/PJ e toggle para incluir clientes inativos.

**Architecture:** Backend recebe query param `includeInactive` opcional em `GET /clients` (Zod coerce boolean); filtros de texto e tipo ficam 100% client-side via `useMemo`; TanStack Query refaz a chamada automaticamente quando `includeInactive` muda via query key.

**Tech Stack:** Fastify v5, Zod, Prisma v6, React 19, TanStack Query, TailwindCSS v4, shadcn/ui, Vitest

---

## Mapa de Arquivos

**Task 1 (backend):**
- Modify: `apps/api/src/modules/clients/clients.schema.ts` — adicionar `listClientsQuerySchema`
- Modify: `apps/api/src/modules/clients/clients.service.ts` — `listClients` aceita `includeInactive`
- Modify: `apps/api/src/modules/clients/clients.routes.ts` — validar e repassar o param
- Create: `apps/api/src/modules/clients/clients.routes.test.ts` — testes da rota GET

**Task 2 (frontend):**
- Modify: `apps/web/src/pages/app/Clients.tsx` — barra de filtros, `useMemo`, cards inativos

---

## Task 1: Backend — query param `includeInactive` em `GET /clients`

**Files:**
- Modify: `apps/api/src/modules/clients/clients.schema.ts`
- Modify: `apps/api/src/modules/clients/clients.service.ts`
- Modify: `apps/api/src/modules/clients/clients.routes.ts`
- Create: `apps/api/src/modules/clients/clients.routes.test.ts`

- [ ] **Escrever os testes que vão falhar**

Criar `apps/api/src/modules/clients/clients.routes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  getAuthHeader,
} from '@/test/helpers'

async function setup() {
  const plan = await createTestPlan()
  const org = await createTestOrg(plan.id)
  const user = await createTestUser(org.id)
  const auth = await getAuthHeader(user.email, 'Test@1234')
  return { org, user, auth }
}

describe('GET /clients', () => {
  it('returns only active clients by default', async () => {
    const { org, auth } = await setup()
    await createTestClient(org.id, { isActive: true })
    await createTestClient(org.id, { isActive: false })

    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ isActive: boolean }[]>()
    expect(body.every((c) => c.isActive === true)).toBe(true)
    expect(body).toHaveLength(1)
  })

  it('returns active and inactive clients when includeInactive=true', async () => {
    const { org, auth } = await setup()
    await createTestClient(org.id, { isActive: true })
    await createTestClient(org.id, { isActive: false })

    const res = await app.inject({
      method: 'GET',
      url: '/clients?includeInactive=true',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ isActive: boolean }[]>()
    expect(body).toHaveLength(2)
  })

  it('returns 200 with empty array when org has no clients', async () => {
    const { auth } = await setup()
    const res = await app.inject({ method: 'GET', url: '/clients', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })
})
```

- [ ] **Verificar que o helper `createTestClient` aceita `isActive`**

```bash
grep -n "createTestClient" apps/api/src/test/helpers.ts | head -5
```

Se `createTestClient` não aceitar `isActive` como opção, localizar a função e adicionar o parâmetro:

```typescript
// Exemplo de assinatura esperada (adaptar ao que já existe):
export async function createTestClient(orgId: string, overrides: Partial<{ isActive: boolean; name: string; email: string }> = {}) {
  return prisma.client.create({
    data: {
      name: overrides.name ?? 'Cliente Teste',
      email: overrides.email ?? `client-${Date.now()}@test.com`,
      passwordHash: await hashPassword('Test@1234'),
      organizationId: orgId,
      isActive: overrides.isActive ?? true,
    },
  })
}
```

- [ ] **Rodar os testes para confirmar que falham**

```bash
/home/max/.local/bin/pnpm --filter api test src/modules/clients/clients.routes.test.ts 2>&1 | tail -15
```

Esperado: falhas porque a rota não aceita `includeInactive` ainda.

- [ ] **Adicionar `listClientsQuerySchema` em `clients.schema.ts`**

Abrir `apps/api/src/modules/clients/clients.schema.ts` e adicionar ao final:

```typescript
export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false),
})

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
```

- [ ] **Atualizar `listClients` em `clients.service.ts`**

Localizar:

```typescript
export async function listClients(organizationId: string) {
  return prisma.client.findMany({
    where: { organizationId, isActive: true },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}
```

Substituir por:

```typescript
export async function listClients(organizationId: string, includeInactive = false) {
  return prisma.client.findMany({
    where: {
      organizationId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}
```

- [ ] **Atualizar a rota `GET /` em `clients.routes.ts`**

Adicionar `listClientsQuerySchema` ao import existente:

```typescript
import { createClientSchema, updateClientSchema, listClientsQuerySchema } from './clients.schema'
```

Localizar o handler do `GET /`:

```typescript
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await listClients(request.user.organizationId!))
  })
```

Substituir por:

```typescript
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
    schema: { querystring: listClientsQuerySchema },
  }, async (request, reply) => {
    const query = request.query as { includeInactive: boolean }
    return reply.send(await listClients(request.user.organizationId!, query.includeInactive))
  })
```

- [ ] **Rodar os testes novamente e confirmar que passam**

```bash
/home/max/.local/bin/pnpm --filter api test src/modules/clients/clients.routes.test.ts 2>&1 | tail -15
```

Esperado: 3 testes passando.

- [ ] **Rodar a suite completa**

```bash
/home/max/.local/bin/pnpm --filter api test 2>&1 | tail -6
```

Esperado: 140+ testes passando (137 existentes + 3 novos).

- [ ] **Commit**

```bash
git add apps/api/src/modules/clients/
git commit -m "feat: GET /clients aceita includeInactive para exibir clientes desativados"
```

---

## Task 2: Frontend — barra de filtros em `Clients.tsx`

**Files:**
- Modify: `apps/web/src/pages/app/Clients.tsx`

Esta task modifica apenas o componente `Clients.tsx`. Não há testes de frontend a escrever (componentes React sem lógica de negócio crítica).

- [ ] **Adicionar `useMemo` ao import do React**

Localizar:

```typescript
import { useState } from 'react'
```

Substituir por:

```typescript
import { useState, useMemo } from 'react'
```

- [ ] **Adicionar os três novos estados de filtro**

Localizar o bloco de estados no topo do componente `Clients` (após `editForm` state e `deletingId`):

```typescript
  const [deletingId, setDeletingId] = useState<string | null>(null)
```

Adicionar após esta linha:

```typescript
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'PF' | 'PJ'>('all')
  const [includeInactive, setIncludeInactive] = useState(false)
```

- [ ] **Atualizar a query para incluir `includeInactive` na query key e nos params**

Localizar:

```typescript
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })
```

Substituir por:

```typescript
  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients', { includeInactive }],
    queryFn: () =>
      api.get('/clients', { params: includeInactive ? { includeInactive: true } : {} })
        .then((r) => r.data),
  })
```

- [ ] **Adicionar a lista filtrada via `useMemo`**

Adicionar logo após o bloco da query (antes dos mutations):

```typescript
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients.filter((c) => {
      const matchType = typeFilter === 'all' || c.clientType === typeFilter
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.cnpj ?? '').toLowerCase().includes(q) ||
        (c.cpf ?? '').toLowerCase().includes(q)
      return matchType && matchSearch
    })
  }, [clients, search, typeFilter])
```

- [ ] **Adicionar a barra de filtros no JSX**

Localizar o bloco de abertura do formulário de criação (após o `<div className="flex items-center justify-between mb-6">`):

```tsx
      {/* Formulário de criação */}
      {showCreate && (
```

Adicionar a barra de filtros entre o header e o formulário de criação:

```tsx
      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nome, e-mail, CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          {(['all', 'PJ', 'PF'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors',
                typeFilter === t ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t === 'all' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Incluir desativados
        </label>
      </div>

      {/* Contador */}
      {clients.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          Exibindo {filtered.length} de {clients.length} cliente{clients.length !== 1 ? 's' : ''}
        </p>
      )}
```

- [ ] **Substituir `clients.map` por `filtered.map` na lista**

Localizar:

```tsx
        {clients.map((client) => (
```

Substituir por:

```tsx
        {filtered.map((client) => (
```

- [ ] **Atualizar a mensagem de lista vazia**

Localizar:

```tsx
        {clients.length === 0 && (
          <p className="text-center text-gray-400 py-12">Nenhum cliente cadastrado.</p>
        )}
```

Substituir por:

```tsx
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-12">
            {clients.length === 0 ? 'Nenhum cliente cadastrado.' : 'Nenhum cliente encontrado para este filtro.'}
          </p>
        )}
```

- [ ] **Adicionar visual de inativo nos cards**

Localizar o div externo do card:

```tsx
          <div key={client.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
```

Substituir por:

```tsx
          <div key={client.id} className={cn('bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between gap-3', !client.isActive && 'opacity-60')}>
```

Localizar o badge de tipo dentro do card:

```tsx
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                  {client.clientType ?? 'PJ'}
                </span>
```

Substituir por:

```tsx
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                  {client.clientType ?? 'PJ'}
                </span>
                {!client.isActive && (
                  <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded flex-shrink-0">
                    Inativo
                  </span>
                )}
```

- [ ] **Verificar build**

```bash
/home/max/.local/bin/pnpm --filter web build 2>&1 | grep -E "error|✓" | head -10
```

Esperado: `✓ built in ...` sem erros TypeScript.

- [ ] **Commit**

```bash
git add apps/web/src/pages/app/Clients.tsx
git commit -m "feat: barra de filtros na página de clientes (busca, tipo PF/PJ, incluir inativos)"
```

---

## Checklist Final de Validação

- [ ] `GET /clients` sem params retorna apenas ativos
- [ ] `GET /clients?includeInactive=true` retorna ativos + inativos
- [ ] 140+ testes da API passando
- [ ] Busca por nome filtra a lista em tempo real
- [ ] Busca por e-mail, CNPJ e CPF funciona
- [ ] Toggle Todos/PJ/PF filtra corretamente
- [ ] "Incluir desativados" faz refetch e exibe clientes inativos com `opacity-60` e badge vermelho
- [ ] Contador "Exibindo X de Y clientes" aparece corretamente
- [ ] Mensagem "Nenhum cliente encontrado para este filtro." quando filtro não tem resultado
- [ ] Build sem erros TypeScript
