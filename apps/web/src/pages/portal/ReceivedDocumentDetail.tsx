import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC, isPastDateOnlyUTC } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { MarkPaidDialog } from '@/components/portal/MarkPaidDialog'
import { documentState, STATE_UI, type ReceivedDocument } from './receivedDocuments'

interface DocumentDetail extends ReceivedDocument {
  content: string | null
  attachment: { filename: string; mimeType: string } | null
  paymentProof: { filename: string } | null
  paidBy: { name: string } | null
  events: { type: string; actorName: string | null; actorType: string; detail: string | null; createdAt: string }[]
}

const EVENT_LABEL: Record<string, string> = {
  SENT: 'Enviado pelo escritório',
  VIEWED: 'Visualizado',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Venceu sem visualização',
  PAID: 'Marcado como pago',
  UNPAID: 'Pagamento desfeito',
  AMOUNT_CHANGED: 'Valor/vencimento corrigido pelo escritório',
  REPLACED: 'Documento atualizado pelo escritório',
  CANCELLED: 'Cancelado',
}

export default function ReceivedDocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [payOpen, setPayOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Opening the detail registers "Visualizado" (protocol semantics)
  const { data: doc, isLoading, isError } = useQuery<DocumentDetail>({
    queryKey: ['portal-protocol', id],
    queryFn: () => api.get(`/portal/protocols/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['portal-protocol', id] })
    queryClient.invalidateQueries({ queryKey: ['portal-protocols'] })
    queryClient.invalidateQueries({ queryKey: ['portal-home'] })
  }
  const openFile = useMutation({
    mutationFn: () => api.get<{ url: string }>(`/portal/protocols/${id}/download`).then((r) => r.data),
    onSuccess: (data) => { window.open(data.url, '_blank', 'noopener,noreferrer'); refresh() },
    onError: () => toast.error('Erro ao abrir o documento'),
  })
  const unpay = useMutation({
    mutationFn: () => api.delete(`/portal/protocols/${id}/pay`),
    onSuccess: () => { toast.success('Pagamento desfeito'); refresh() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao desfazer pagamento')),
  })

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
  if (isError || !doc) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-muted-foreground">Documento não encontrado.</p>
        <Link to="/portal/documents" className="text-sm text-accent-hover hover:underline">Voltar</Link>
      </div>
    )
  }

  const overdue = !!doc.dueDate && isPastDateOnlyUTC(doc.dueDate, new Date())
  const st = STATE_UI[documentState(doc, overdue)]

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <Link to="/portal/documents" className="inline-flex items-center gap-1 text-sm text-accent-hover hover:underline">
        <ArrowLeft size={14} /> Voltar
      </Link>

      <div className="rounded-lg bg-surface p-4 shadow-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">{doc.title}</h1>
            <p className="text-xs text-muted-foreground">{doc.departmentName} · protocolo {doc.number}</p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', st.cls)}>{st.label}</span>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Vencimento</dt><dd className="text-foreground">{doc.dueDate ? formatDateOnlyUTC(doc.dueDate) : '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Competência</dt><dd className="text-foreground">{doc.competence ? formatDateOnlyUTC(doc.competence).slice(3) : '—'}</dd></div>
          {doc.requiresPayment && (
            <div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="font-semibold text-foreground">{doc.amount ? formatBRL(doc.amount) : '—'}</dd></div>
          )}
        </dl>

        {doc.fileUpdatedAt && (
          <p className="text-xs text-muted-foreground">Documento atualizado em {new Date(doc.fileUpdatedAt).toLocaleDateString('pt-BR')}.</p>
        )}
        {doc.content && <p className="whitespace-pre-wrap text-sm text-foreground">{doc.content}</p>}

        {doc.requiresPayment && (
          <div className="rounded-md border border-border p-3">
            {doc.paidAt ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-success-text">
                  Pago{doc.paidAmount ? ` — ${formatBRL(doc.paidAmount)}` : ''} em {new Date(doc.paidAt).toLocaleDateString('pt-BR')}
                  {doc.paidBy && ` por ${doc.paidBy.name}`}
                </p>
                <Button
                  variant="ghost" size="sm" disabled={unpay.isPending}
                  onClick={() => { if (window.confirm('Desfazer o pagamento desta guia?')) unpay.mutate() }}
                >
                  Desfazer
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn('text-sm', overdue ? 'font-medium text-danger-text' : 'text-foreground')}>
                  {overdue ? 'Esta guia venceu e ainda não foi marcada como paga.' : 'Já pagou? Marque aqui para o seu controle.'}
                </p>
                <Button size="sm" onClick={() => setPayOpen(true)}>Marcar como pago</Button>
              </div>
            )}
          </div>
        )}

        {doc.attachment && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => openFile.mutate()} disabled={openFile.isPending}>
              <ExternalLink size={14} /> Abrir / baixar documento
            </Button>
          </div>
        )}

        <div>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-accent-hover hover:underline">
            {showHistory ? 'Ocultar histórico' : 'Ver histórico'}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1">
              {doc.events.map((e, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{EVENT_LABEL[e.type] ?? e.type}</span>
                  {e.actorName && ` — ${e.actorName}`}
                  {e.detail && ` (${e.detail})`}
                  {' · '}{new Date(e.createdAt).toLocaleString('pt-BR')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {payOpen && (
        <MarkPaidDialog
          protocolId={doc.id}
          amount={doc.amount}
          open={payOpen}
          onOpenChange={setPayOpen}
          onDone={() => { setPayOpen(false); refresh() }}
        />
      )}
    </div>
  )
}
