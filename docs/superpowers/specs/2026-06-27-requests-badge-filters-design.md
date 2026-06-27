# Design — Badge de Pendentes (tempo real) + Filtros na Lista de Requests

## Objetivo

Duas melhorias sobre a feature de Requests (já em produção na `main`):

1. O escritório precisa ver, sem precisar entrar na tela, quantas solicitações de
   clientes estão pendentes — um contador no item "Solicitações" do menu lateral,
   atualizado em tempo real.
2. A tela "Solicitações dos Clientes" (`/app/requests`) precisa de filtros
   adicionais para não embolar quando o escritório tem 200+ clientes.

## 1. Badge de pendentes em tempo real

### Backend

**`apps/api/src/lib/sse.ts`** — nova função, ao lado da já existente
`publishBoardEvent` (não remove nem altera nada existente):

```typescript
export async function publishOrgEvent(organizationId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`org:${organizationId}:requests`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}
```

`SSEEvent['event']` ganha o valor `'request:changed'` na união de tipos.

**Novo endpoint SSE** `GET /requests/stream?token=` em
`apps/api/src/modules/requests/requests.routes.ts`, seguindo o mesmo padrão de
`apps/api/src/modules/stream/stream.routes.ts` (`boards/:id/stream`):
auth via query param (`EventSource` não manda headers customizados), valida o
JWT manualmente, sem escopo de recurso (`:id`) — o `organizationId` já vem do
token. Restrito a `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER` (mesmos papéis que já
veem o item "Solicitações" no menu). Assina o canal Redis
`org:${organizationId}:requests`.

**Disparo do evento**: em `requests.service.ts`, ao final de `createRequest`,
`approveRequest`, `rejectRequest` e `cancelRequest`, chamar:

```typescript
await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
```

Não carrega payload — é só um sinal para o frontend invalidar a contagem.

**Novo endpoint** `GET /requests/pending-count` em `requests.routes.ts`,
retornando `{ count: number }` — `prisma.request.count({ where: {
organizationId, status: 'PENDING' } })`. Existe separado do `GET /requests`
porque este é chamado pelo `AppLayout`, presente em toda página do painel —
buscar a lista inteira só para contar seria desperdício de banda.

### Frontend

**Novo hook** `apps/web/src/hooks/useRequestsBadgeStream.ts` — réplica do
padrão de `useBoardStream.ts` (mesmo reconectar com backoff exponencial,
mesmo delay de 50ms anti-StrictMode), mas conectando em
`/requests/stream?token=` (sem parâmetro de board) e invalidando
`['requests-pending-count']` a cada evento `request:changed` recebido (e a
cada `heartbeat`, só para resetar o backoff).

**`apps/web/src/components/AppLayout.tsx`**: adiciona
`useQuery(['requests-pending-count'], () => api.get('/requests/pending-count'))`
e chama `useRequestsBadgeStream()` — ambos condicionados a
`ORG_ROLES.includes(role)` (mesma guarda já usada para mostrar o link). O
`SidebarLink` de "Solicitações" ganha uma prop opcional `badge?: number`,
renderizando uma bolinha vermelha com o número (ou "9+" se > 9) à direita do
label, oculta quando `count === 0` ou `undefined`.

## 2. Filtros na lista do escritório

Em `apps/web/src/pages/app/Requests.tsx`, abaixo do filtro de status já
existente, adicionar (mesmo padrão visual/de estado de `Processes.tsx`):

- **Busca por texto** (`search`, `useState`): filtra client-side por
  `r.title` OU `r.client?.name` (case-insensitive, `includes`).
- **Período** (`dateFrom`/`dateTo`, inputs `type="date"`): filtra client-side
  por `r.createdAt` dentro do intervalo (inclusive).

Esses filtros operam sobre o resultado já retornado por `GET
/requests?status=` (que continua sendo o filtro server-side, como hoje) — não
precisa de novos parâmetros de query no backend, já que o volume após filtrar
por status (a visão padrão é "Pendentes") tende a ser pequeno mesmo com
200+ clientes na organização.

Não há dropdown de cliente separado — a busca por texto já cobre esse caso e
evita um `<select>` com 200+ opções.

## Fora do escopo

- Paginação no `GET /requests` (não necessária dado o volume esperado após o
  filtro de status).
- Notificação sonora/visual além do badge numérico.
- Badge de contagem no portal do cliente (este design é só para o painel do
  escritório).
