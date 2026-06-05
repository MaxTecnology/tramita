# Clientes — Filtro e Busca — Design Spec

**Data:** 2026-06-04
**Escopo:** Adicionar barra de filtros à página de Clientes (busca por texto, tipo PF/PJ, toggle de inativos)
**Motivação:** Escritórios com 400+ clientes precisam de busca para localizar registros rapidamente.

---

## Abordagem escolhida

Filtro client-side para texto e tipo (React state + `useMemo`). Toggle "incluir desativados" muda a query key do TanStack Query, disparando refetch com `?includeInactive=true` no backend. Nenhuma migration necessária.

---

## Backend

### Mudanças

**`apps/api/src/modules/clients/clients.schema.ts`**

Adicionar schema de query params:

```typescript
export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().optional().default(false),
})
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
```

**`apps/api/src/modules/clients/clients.service.ts`**

`listClients` recebe `includeInactive?: boolean`:

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

**`apps/api/src/modules/clients/clients.routes.ts`**

Rota `GET /` passa `includeInactive` para o service:

```typescript
app.get('/', {
  preHandler: [...],
  schema: { querystring: listClientsQuerySchema },
  handler: async (req, reply) => {
    const { includeInactive } = req.query
    const clients = await listClients(req.organizationId, includeInactive)
    return reply.send(clients)
  },
})
```

---

## Frontend

### Estado local em `Clients.tsx`

```typescript
const [search, setSearch] = useState('')
const [typeFilter, setTypeFilter] = useState<'all' | 'PF' | 'PJ'>('all')
const [includeInactive, setIncludeInactive] = useState(false)
```

### Query TanStack

`includeInactive` entra na query key para forçar refetch quando toggled:

```typescript
const { data: clients = [], isLoading } = useQuery<Client[]>({
  queryKey: ['clients', { includeInactive }],
  queryFn: () =>
    api.get('/clients', { params: includeInactive ? { includeInactive: true } : {} })
      .then((r) => r.data),
})
```

### Lista filtrada via `useMemo`

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

### Layout da barra de filtros

Renderizada entre o cabeçalho e o formulário de criação (quando fechado) ou acima da lista:

```
[ 🔍 Buscar por nome, e-mail, CPF/CNPJ... ] [ Todos | PJ | PF ] [ ◻ Incluir desativados ]
```

- Input de busca: `w-full` no mobile, fixo em desktop
- Toggle de tipo: botões segmentados (reutiliza o padrão `TypeToggle` com três opções)
- Checkbox/switch para inativos: label `Incluir desativados`
- Contador: `Exibindo X de Y clientes` em texto `xs text-gray-400`, visível apenas quando há filtro ativo ou `Y > 0`

### Visual de clientes inativos

Clientes com `isActive: false` renderizados com:
- `opacity-60` no card
- Badge `Inativo` em vermelho claro ao lado do nome

### Interface `Client` (sem mudança)

`isActive` já está na interface — nenhuma alteração em `types/index.ts`.

---

## Sem migrations

Nenhuma alteração de schema de banco. O campo `isActive` já existe.

---

## Testes

- Nenhum teste novo necessário no backend (lógica trivial — condicional no `where`)
- Testes existentes continuam passando (padrão `isActive: true` mantido por default)

---

## Checklist de entrega

- [ ] `listClientsQuerySchema` adicionado com `includeInactive`
- [ ] `listClients` aceita e aplica `includeInactive`
- [ ] Rota `GET /clients` valida e repassa o param
- [ ] Frontend: estados `search`, `typeFilter`, `includeInactive`
- [ ] Query key inclui `includeInactive`
- [ ] `useMemo` aplica filtros de texto e tipo
- [ ] Barra de filtros renderizada com input, toggle de tipo, switch de inativos
- [ ] Cards inativos com `opacity-60` + badge `Inativo`
- [ ] Contador `Exibindo X de Y clientes`
- [ ] Build passa sem erros TypeScript
- [ ] Testes da API: 137+ passando
