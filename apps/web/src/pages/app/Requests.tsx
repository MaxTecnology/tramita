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
import { Inbox, X, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { ScopeFilter, useScopeFilter, scopeParams } from '@/components/shared/ScopeFilter'
import { useMyScope } from '@/hooks/useMyScope'
import { useLinkedItem } from '@/hooks/useLinkedItem'
import { RequestAttachments } from '@/components/requests/RequestAttachments'
import { PageHeader } from '@/components/ui/page-header'
import { SearchField } from '@/components/ui/search-field'
import { formatDateOnlyUTC } from '@/lib/dates'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Precisa de informação',
}

// Filter chips: the plural says what the list holds
const FILTER_LABEL: Record<ClientRequest['status'] | '', string> = {
  PENDING: 'Pendentes', NEEDS_INFO: 'Aguardando o cliente', APPROVED: 'Aprovadas', REJECTED: 'Rejeitadas', CANCELLED: 'Canceladas', '': 'Todas',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-warning-bg text-warning-text',
  APPROVED: 'bg-success-bg text-success-text',
  REJECTED: 'bg-danger-bg text-danger-text',
  CANCELLED: 'bg-neutral-bg text-muted-foreground',
  NEEDS_INFO: 'bg-info-bg text-info-text',
}

type Mode = 'NEW_BOARD' | 'EXISTING_BOARD' | 'OS'

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
  const [osModelId, setOsModelId] = useState('')
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

  // Standalone OS models: a request for an OS opens as it; a free one can be turned into one
  const { data: standaloneModels = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['os-models', 'standalone'],
    queryFn: () => api.get('/os-models', { params: { usage: 'standalone' } }).then((r) => r.data),
    enabled: !!approving,
  })

  function openApproval(req: ClientRequest) {
    setApproving(req)
    setMode(req.osModelId ? 'OS' : 'NEW_BOARD')
    setOsModelId(req.osModelId ?? '')
  }

  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/requests/${approving!.id}/approve`,
        mode === 'OS' ? { mode: 'OS', osModelId }
          : mode === 'NEW_BOARD' ? { mode: 'NEW_BOARD' } : { mode: 'EXISTING_BOARD', boardId, columnId },
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando solicitações...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        title="Solicitações"
        description="O que os clientes pedem pelo portal. Aprovar abre o processo ou a OS; pedir mais informação devolve a pergunta ao cliente."
      />

      <div className="flex flex-wrap items-center gap-2">
        {me && <ScopeFilter me={me} value={scopeFilter} onChange={setScopeFilter} />}
        <SearchField label="Buscar solicitações" placeholder="Cliente ou título" value={search} onChange={setSearch} className="w-full sm:w-64" />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Recebidas de
          <input id="req-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          até
          <input id="req-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="flex h-9 items-center gap-1 px-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <X size={14} aria-hidden />
            Limpar filtros
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label="Situação" className="flex flex-wrap gap-1.5">
        {(['PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED', ''] as const).map((st) => (
          <button
            key={st || 'all'}
            type="button"
            role="radio"
            aria-checked={statusFilter === st}
            onClick={() => setStatusFilter(st)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              statusFilter === st ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {FILTER_LABEL[st]}
          </button>
        ))}
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
                    <p className="text-xs text-muted-foreground">
                      {[
                        r.client?.name,
                        `Recebida em ${new Date(r.createdAt).toLocaleDateString("pt-BR")}`,
                        r.processTemplate?.name,
                        r.competence ? `competência ${formatDateOnlyUTC(r.competence).slice(3)}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                    {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-muted-foreground mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                    <RequestAttachments requestId={r.id} attachments={r.attachments ?? []} canUpload={false} />
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  {r.status === 'PENDING' && (
                    <>
                      <Button size="sm" onClick={() => openApproval(r)} className="bg-accent hover:bg-accent-hover text-accent-foreground">
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
                      <Button size="sm" onClick={() => openApproval(r)} className="bg-accent hover:bg-accent-hover text-accent-foreground">
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-danger-text border-danger-text/30 hover:bg-danger-bg">
                        Rejeitar
                      </Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <Button size="sm" variant="outline" onClick={() => setCancelling(r)} className="text-danger-text border-danger-text/30 hover:bg-danger-bg">
                      Cancelar solicitação
                    </Button>
                  )}
                  {/* CANCELLED pode ter boardId (foi aprovada antes de cancelar) — a tarefa virou
                      DISREGARDED, não é mais um processo ativo pra "abrir". */}
                  {r.boardId && r.status !== 'CANCELLED' && (
                    <Link
                      to={`/app/board/${r.boardId}`}
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} aria-hidden />
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
                aria-pressed={mode === 'NEW_BOARD'}
                onClick={() => setMode('NEW_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'NEW_BOARD' ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground')}
              >
                Criar novo processo
              </button>
              <button
                type="button"
                aria-pressed={mode === 'EXISTING_BOARD'}
                onClick={() => setMode('EXISTING_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'EXISTING_BOARD' ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground')}
              >
                Anexar a processo existente
              </button>
              <button
                type="button"
                aria-pressed={mode === 'OS'}
                onClick={() => setMode('OS')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'OS' ? 'bg-accent text-accent-foreground' : 'bg-surface text-muted-foreground')}
              >
                Abrir como OS
              </button>
            </div>

            {mode === 'NEW_BOARD' && (
              <p className="text-xs text-muted-foreground">
                {approving?.processTemplate
                  ? `Será aberto o processo do modelo "${approving.processTemplate.name}", com as colunas e as OS desse modelo.`
                  : `Será criado um novo processo "${approving?.title}" com 3 colunas padrão (Pendente → Em andamento → Concluído).`}
              </p>
            )}

            {mode === 'OS' && (
              <div className="space-y-1.5">
                <Label htmlFor="approve-os-model">Modelo de OS</Label>
                <select id="approve-os-model" value={osModelId} onChange={(e) => setOsModelId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm">
                  <option value="">Selecione o modelo</option>
                  {standaloneModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">A OS nasce com os documentos, o robô e o prazo do modelo{approving?.competence ? `, competência ${approving.competence.slice(5, 7)}/${approving.competence.slice(0, 4)}` : ''}.</p>
              </div>
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
                disabled={approveMutation.isPending || (mode === 'EXISTING_BOARD' && (!boardId || !columnId)) || (mode === 'OS' && !osModelId)}
                className="bg-accent hover:bg-accent-hover text-accent-foreground"
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
                className="bg-accent hover:bg-accent-hover text-accent-foreground"
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
