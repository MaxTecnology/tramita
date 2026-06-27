import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Inbox, Search, X } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

type Mode = 'NEW_BOARD' | 'EXISTING_BOARD'

export default function Requests() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<ClientRequest['status'] | ''>('PENDING')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [approving, setApproving] = useState<ClientRequest | null>(null)
  const [rejecting, setRejecting] = useState<ClientRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [mode, setMode] = useState<Mode>('NEW_BOARD')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['requests', statusFilter],
    queryFn: () => api.get('/requests', { params: statusFilter ? { status: statusFilter } : {} }).then((r) => r.data),
  })

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (search) {
        const q = search.toLowerCase()
        const matchesTitle = r.title.toLowerCase().includes(q)
        const matchesClient = (r.client?.name ?? '').toLowerCase().includes(q)
        if (!matchesTitle && !matchesClient) return false
      }
      if (dateFrom && new Date(r.createdAt) < new Date(dateFrom + 'T00:00:00')) return false
      if (dateTo && new Date(r.createdAt) > new Date(dateTo + 'T23:59:59')) return false
      return true
    })
  }, [requests, search, dateFrom, dateTo])

  const hasActiveFilter = !!search || !!dateFrom || !!dateTo

  const { data: clientBoards = [] } = useQuery<Board[]>({
    queryKey: ['boards', 'by-client', approving?.client?.id],
    queryFn: () => api.get('/boards', { params: { clientId: approving?.client?.id } }).then((r) => r.data),
    enabled: !!approving && mode === 'EXISTING_BOARD',
  })

  const selectedBoard = clientBoards.find((b) => b.id === boardId)

  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/requests/${approving!.id}/approve`,
        mode === 'NEW_BOARD' ? { mode: 'NEW_BOARD' } : { mode: 'EXISTING_BOARD', boardId, columnId },
      ),
    onSuccess: () => {
      toast.success('Solicitação aprovada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setApproving(null)
      setMode('NEW_BOARD')
      setBoardId('')
      setColumnId('')
    },
    onError: () => toast.error('Erro ao aprovar solicitação'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/requests/${rejecting!.id}/reject`, { reason: rejectReason || undefined }),
    onSuccess: () => {
      toast.success('Solicitação rejeitada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setRejecting(null)
      setRejectReason('')
    },
    onError: () => toast.error('Erro ao rejeitar solicitação'),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Solicitações dos Clientes</h1>
      </div>

      <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
        {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            {s ? STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por cliente ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-gray-200 focus:ring-[#185FA5]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-from" className="text-xs text-gray-500 whitespace-nowrap">De</Label>
          <Input
            id="req-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 border-gray-200"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-to" className="text-xs text-gray-500 whitespace-nowrap">Até</Label>
          <Input
            id="req-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 border-gray-200"
          />
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="h-9 px-2 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            <X size={13} />
            Limpar
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <p className="text-xs text-gray-400">
          {filtered.length === requests.length
            ? `${requests.length} solicitação${requests.length !== 1 ? 'ões' : ''}`
            : `Exibindo ${filtered.length} de ${requests.length}`}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {requests.length === 0 ? 'Nenhuma solicitação encontrada' : 'Nenhuma solicitação encontrada para este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  <p className="text-xs text-gray-500">{r.client?.name}</p>
                  {r.description && <p className="text-xs text-gray-500 mt-1">{r.description}</p>}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status === 'PENDING' && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                    Aprovar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-red-600 border-red-200 hover:bg-red-50">
                    Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de aprovação */}
      <Dialog open={!!approving} onOpenChange={(open) => { if (!open) setApproving(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Aprovar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => setMode('NEW_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'NEW_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600')}
              >
                Criar novo processo
              </button>
              <button
                type="button"
                onClick={() => setMode('EXISTING_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'EXISTING_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600')}
              >
                Anexar a processo existente
              </button>
            </div>

            {mode === 'NEW_BOARD' && (
              <p className="text-xs text-gray-500">
                Será criado um novo processo "{approving?.title}" com 3 colunas padrão (Pendente → Em andamento → Concluído).
              </p>
            )}

            {mode === 'EXISTING_BOARD' && (
              <>
                <div className="space-y-1.5">
                  <Label>Processo</Label>
                  <select
                    value={boardId}
                    onChange={(e) => { setBoardId(e.target.value); setColumnId('') }}
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                  >
                    <option value="">Selecione um processo</option>
                    {clientBoards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </div>
                {selectedBoard && (
                  <div className="space-y-1.5">
                    <Label>Coluna</Label>
                    <select
                      value={columnId}
                      onChange={(e) => setColumnId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    >
                      <option value="">Selecione uma coluna</option>
                      {selectedBoard.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setApproving(null)}>Cancelar</Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || (mode === 'EXISTING_BOARD' && (!boardId || !columnId))}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {approveMutation.isPending ? 'Aprovando...' : 'Aprovar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de rejeição */}
      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rejeitar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Motivo (opcional)</Label>
              <textarea
                id="reject-reason"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button>
              <Button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {rejectMutation.isPending ? 'Rejeitando...' : 'Rejeitar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
