import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comments } from '@/components/shared/Comments'
import { cn } from '@/lib/utils'
import { Inbox, Search, X, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'
import { useLinkedItem } from '@/hooks/useLinkedItem'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Precisa de informação',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-warning-bg text-warning-text',
  APPROVED: 'bg-success-bg text-success-text',
  REJECTED: 'bg-danger-bg text-danger-text',
  CANCELLED: 'bg-neutral-bg text-muted-foreground',
  NEEDS_INFO: 'bg-info-bg text-info-text',
}

type Mode = 'NEW_BOARD' | 'EXISTING_BOARD'

export default function Requests() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [statusFilter, setStatusFilter] = useState<ClientRequest['status'] | ''>('PENDING')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [approving, setApproving] = useState<ClientRequest | null>(null)
  const [rejecting, setRejecting] = useState<ClientRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [needsInfoTarget, setNeedsInfoTarget] = useState<ClientRequest | null>(null)
  const [needsInfoComment, setNeedsInfoComment] = useState('')
  const [cancelling, setCancelling] = useState<ClientRequest | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [mode, setMode] = useState<Mode>('NEW_BOARD')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // From a notification: every status (the request may have moved on), opened and scrolled to
  useLinkedItem('request', (id) => { setStatusFilter(''); setExpandedId(id) })

  const me = useMyScope()
  const [scopeFilter, setScopeFilter] = useScopeFilter('requests', me)

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['requests', statusFilter, scopeFilter],
    queryFn: () => api.get('/requests', {
      params: { ...scopeParams(scopeFilter), ...(statusFilter ? { status: statusFilter } : {}) },
    }).then((r) => r.data),
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

  // Scroll once to the request opened from a notification (not again on every list refresh)
  const scrolledTo = useRef<string | null>(null)
  useEffect(() => {
    if (!expandedId || scrolledTo.current === expandedId || !requests.some((r) => r.id === expandedId)) return
    scrolledTo.current = expandedId
    document.getElementById(`request-${expandedId}`)?.scrollIntoView?.({ block: 'center' })
  }, [expandedId, requests])

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

  const needsInfoMutation = useMutation({
    mutationFn: () => api.post(`/requests/${needsInfoTarget!.id}/needs-info`, { comment: needsInfoComment }),
    onSuccess: () => {
      toast.success('Pedido de informação enviado ao cliente')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setNeedsInfoTarget(null)
      setNeedsInfoComment('')
    },
    onError: () => toast.error('Erro ao pedir mais informação'),
  })

  const cancelApprovedMutation = useMutation({
    mutationFn: () => api.post(`/requests/${cancelling!.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success('Solicitação cancelada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setCancelling(null)
      setCancelReason('')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 409) {
        toast.error('Essa tarefa já teve movimentação — não pode ser cancelada por aqui')
      } else {
        toast.error('Erro ao cancelar solicitação')
      }
    },
  })

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Solicitações dos Clientes</h1>
      </div>

      {me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}

      <div className="flex rounded-md border border-border overflow-hidden w-fit flex-wrap">
        {(['PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
            )}
          >
            {s ? STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-border focus:ring-accent"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-from" className="text-xs text-muted-foreground whitespace-nowrap">De</Label>
          <Input
            id="req-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 border-border"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-to" className="text-xs text-muted-foreground whitespace-nowrap">Até</Label>
          <Input
            id="req-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 border-border"
          />
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <X size={13} />
            Limpar
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtered.length === requests.length
            ? `${requests.length} solicitação${requests.length !== 1 ? 'ões' : ''}`
            : `Exibindo ${filtered.length} de ${requests.length}`}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {requests.length === 0 ? 'Nenhuma solicitação encontrada' : 'Nenhuma solicitação encontrada para este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} id={`request-${r.id}`} className="bg-surface rounded-lg border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.client?.name}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-muted-foreground mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  {r.status === 'PENDING' && (
                    <>
                      <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-danger-text border-danger-text/30 hover:bg-danger-bg">
                        Rejeitar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setNeedsInfoTarget(r)}>
                        Pedir mais informação
                      </Button>
                    </>
                  )}
                  {r.status === 'NEEDS_INFO' && (
                    <>
                      <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-danger-text border-danger-text/30 hover:bg-danger-bg">
                        Rejeitar
                      </Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <Button size="sm" variant="outline" onClick={() => setCancelling(r)} className="text-danger-text border-danger-text/30 hover:bg-danger-bg">
                      Cancelar
                    </Button>
                  )}
                  {/* CANCELLED pode ter boardId (foi aprovada antes de cancelar) — a tarefa virou
                      DISREGARDED, não é mais um processo ativo pra "abrir". */}
                  {r.boardId && r.status !== 'CANCELLED' && (
                    <Link
                      to={`/app/board/${r.boardId}`}
                      className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} />
                      Abrir processo
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-auto"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Comentários
                  </button>
                </div>

                {isExpanded && user && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Comments
                      entityType="request"
                      entityId={r.id}
                      currentUserId={user.id}
                      role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de aprovação */}
      <Dialog open={!!approving} onOpenChange={(open) => { if (!open) setApproving(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Aprovar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => setMode('NEW_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'NEW_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
              >
                Criar novo processo
              </button>
              <button
                type="button"
                onClick={() => setMode('EXISTING_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'EXISTING_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
              >
                Anexar a processo existente
              </button>
            </div>

            {mode === 'NEW_BOARD' && (
              <p className="text-xs text-muted-foreground">
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
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
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
                      className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
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
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button>
              <Button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="bg-danger-text hover:bg-danger-hover text-danger-foreground"
              >
                {rejectMutation.isPending ? 'Rejeitando...' : 'Rejeitar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de "pedir mais informação" */}
      <Dialog open={!!needsInfoTarget} onOpenChange={(open) => { if (!open) setNeedsInfoTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pedir mais informação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="needs-info-comment">O que você precisa saber?</Label>
              <textarea
                id="needs-info-comment"
                rows={3}
                value={needsInfoComment}
                onChange={(e) => setNeedsInfoComment(e.target.value)}
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
                placeholder="Ex: Qual o CNPJ da empresa?"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNeedsInfoTarget(null)}>Cancelar</Button>
              <Button
                onClick={() => needsInfoMutation.mutate()}
                disabled={needsInfoMutation.isPending || !needsInfoComment.trim()}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {needsInfoMutation.isPending ? 'Enviando...' : 'Enviar pedido'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de cancelamento pós-aprovação */}
      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) setCancelling(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancelar solicitação aprovada</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              A tarefa criada a partir desta solicitação será marcada como desconsiderada. Só é possível cancelar se a tarefa ainda não teve nenhuma movimentação (comentário, anexo ou mudança de coluna).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Motivo (obrigatório)</Label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCancelling(null)}>Voltar</Button>
              <Button
                onClick={() => cancelApprovedMutation.mutate()}
                disabled={cancelApprovedMutation.isPending || !cancelReason.trim()}
                className="bg-danger-text hover:bg-danger-hover text-danger-foreground"
              >
                {cancelApprovedMutation.isPending ? 'Cancelando...' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
