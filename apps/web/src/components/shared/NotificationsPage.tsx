import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { NotificationList } from './NotificationList'
import {
  notificationsApi, TYPE_LABEL, STAFF_TYPES, CLIENT_TYPES, UNREAD_KEY, LIST_KEY, type InAppNotification, type InAppType,
} from './notifications'

type Status = 'all' | 'unread' | 'read'
const STATUS_TABS: { value: Status; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'read', label: 'Lidas' },
]

const field = 'rounded-md border border-border bg-surface text-foreground text-sm px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export function NotificationsPage({ side, onOpen }: { side: 'staff' | 'client'; onOpen?: (n: InAppNotification) => void }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>('all')
  const [type, setType] = useState<InAppType | ''>('')
  const [clientId, setClientId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')

  const { data: clients = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
    enabled: side === 'staff',
  })

  const filters = { status, type: type || undefined, clientId: clientId || undefined, from: from || undefined, to: to || undefined, q: q.trim() || undefined }
  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, 'page', filters],
    queryFn: ({ pageParam }) => notificationsApi.list({ ...filters, limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const readAll = useMutation({
    mutationFn: notificationsApi.readAll,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: UNREAD_KEY }), qc.invalidateQueries({ queryKey: LIST_KEY })]),
  })

  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const types = side === 'staff' ? STAFF_TYPES : CLIENT_TYPES

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Notificações</h1>
        <button
          type="button"
          onClick={() => readAll.mutate()}
          disabled={readAll.isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-neutral-bg disabled:opacity-50"
        >
          Marcar todas como lidas
        </button>
      </div>

      <div role="tablist" aria-label="Situação" className="inline-flex rounded-md border border-border bg-surface p-0.5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={status === t.value}
            onClick={() => setStatus(t.value)}
            className={cn('rounded px-3 py-1 text-sm', status === t.value ? 'bg-neutral-bg text-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tipo
          <select aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value as InAppType | '')} className={field}>
            <option value="">Todos</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        {side === 'staff' && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Cliente
            <select aria-label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} className={cn(field, 'max-w-[14rem]')}>
              <option value="">Todos</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          De
          <input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Até
          <input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground flex-1 min-w-[12rem]">
          Buscar
          <input type="search" aria-label="Buscar" placeholder="Texto da notificação" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
        </label>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {list.isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : list.isError ? (
          <p className="px-4 py-8 text-center text-sm text-danger-text">Não foi possível carregar as notificações.</p>
        ) : (
          <NotificationList items={items} onOpen={onOpen} detailed />
        )}
      </div>

      {list.hasNextPage && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="rounded-md border border-border px-4 py-1.5 text-sm text-foreground hover:bg-neutral-bg disabled:opacity-50"
          >
            {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}
    </div>
  )
}
