import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Inbox, Download, Search } from 'lucide-react'
import type { Protocol } from '@/types'
import { toast } from 'sonner'
import { usePortalClient } from './Layout'

const STATUS_LABEL: Record<Protocol['status'], string> = {
  SENT: 'Enviado',
  VIEWED: 'Visualizado',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Vencido',
}

const STATUS_STYLE: Record<Protocol['status'], string> = {
  SENT: 'bg-amber-100 text-amber-700',
  VIEWED: 'bg-blue-100 text-blue-700',
  DOWNLOADED: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-red-100 text-red-700',
}

export default function PortalProtocols() {
  const { clientId } = usePortalClient()
  const [statusFilter, setStatusFilter] = useState<Protocol['status'] | ''>('')
  const [search, setSearch] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null)

  const { data: protocols = [], isLoading } = useQuery<Protocol[]>({
    queryKey: ['portal-protocols', clientId, statusFilter, search],
    queryFn: () => api.get('/portal/protocols', {
      params: { clientId, status: statusFilter || undefined, search: search || undefined },
    }).then((r) => r.data),
    enabled: !!clientId,
  })

  const viewMutation = useMutation({
    mutationFn: (id: string) => api.get(`/portal/protocols/${id}`).then((r) => r.data),
    onSuccess: (_, id) => setOpenedId(id),
    onError: () => toast.error('Erro ao abrir protocolo'),
  })

  const downloadMutation = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/portal/protocols/${id}/download`).then((r) => r.data),
    onSuccess: (data) => window.open(data.url, '_blank'),
    onError: () => toast.error('Erro ao baixar arquivo'),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Meus Protocolos</h1>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-border focus:ring-accent"
          />
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(['', 'SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED'] as const).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {s ? STATUS_LABEL[s] : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {protocols.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum protocolo ainda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {protocols.map((p) => (
            <div key={p.id} className="bg-surface rounded-lg border border-border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{p.number}</p>
                  <p className="text-sm font-medium text-foreground">{p.title}</p>
                  {p.dueDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vencimento: {new Date(p.dueDate).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[p.status])}>
                  {STATUS_LABEL[p.status]}
                </span>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => viewMutation.mutate(p.id)}
                  className="text-xs text-[#185FA5] hover:underline"
                >
                  {openedId === p.id ? 'Visualizado' : 'Abrir'}
                </button>
                {p.attachmentId && (
                  <button
                    type="button"
                    onClick={() => downloadMutation.mutate(p.id)}
                    className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                  >
                    <Download size={12} />
                    Baixar
                  </button>
                )}
              </div>

              {openedId === p.id && p.content && (
                <p className="text-sm text-foreground mt-2 pt-2 border-t border-border">{p.content}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
