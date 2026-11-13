import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { UPLOAD_ACCEPT } from '@/lib/upload'
import { cn, mensagemDeErro } from '@/lib/utils'
import { APPROVAL_BADGE, CLOSE_REASON_LABEL, decisionText, type Approval, type CloseReason } from '@/components/shared/approvals'

const field = 'w-full rounded-md border border-border bg-surface text-foreground text-sm px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

export const approvalsKey = (taskId: string) => ['task-approvals', taskId]

export function useTaskApprovals(taskId: string, enabled = true) {
  return useQuery<Approval[]>({
    queryKey: approvalsKey(taskId),
    queryFn: () => api.get(`/tasks/${taskId}/approvals`).then((r) => r.data),
    enabled,
  })
}

// Office side of the client's approval (task drawer, Documents tab)
export function ApprovalsSection({ taskId, canEdit, visibleToClient }: { taskId: string; canEdit: boolean; visibleToClient: boolean }) {
  const qc = useQueryClient()
  const { data: approvals = [] } = useTaskApprovals(taskId)
  const [asking, setAsking] = useState(false)
  const hasPending = approvals.some((a) => a.status === 'PENDING')
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: approvalsKey(taskId) }),
    qc.invalidateQueries({ queryKey: ['tasks'] }),
    qc.invalidateQueries({ queryKey: ['task-history', taskId] }),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aprovação do cliente</p>
        {canEdit && visibleToClient && !hasPending && !asking && (
          <Button size="sm" variant="outline" onClick={() => setAsking(true)}>Pedir aprovação do cliente</Button>
        )}
      </div>
      {!visibleToClient && approvals.length === 0 && (
        <p className="text-sm text-muted-foreground">Pedido de aprovação disponível só em tarefa visível ao cliente.</p>
      )}
      {asking && <RequestForm taskId={taskId} onDone={() => { setAsking(false); void refresh() }} onCancel={() => setAsking(false)} />}
      <div className="space-y-2">
        {approvals.map((a) => <ApprovalCard key={a.id} approval={a} canEdit={canEdit} onChanged={refresh} />)}
      </div>
    </div>
  )
}

function RequestForm({ taskId, onDone, onCancel }: { taskId: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const send = useMutation({
    mutationFn: () => {
      // Text fields go before the file (the API reads them from the file part)
      const form = new FormData()
      form.append('title', title.trim())
      if (message.trim()) form.append('message', message.trim())
      form.append('file', file!)
      return api.post(`/tasks/${taskId}/approvals`, form)
    },
    onSuccess: () => { toast.success('Pedido de aprovação enviado ao cliente'); onDone() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao pedir aprovação')),
  })

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send.mutate() }}
      className="mb-3 space-y-2 rounded-lg border border-border bg-neutral-bg p-3"
    >
      <label className="block text-xs text-muted-foreground">
        Título
        <input aria-label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Prévia da folha de novembro" className={cn(field, 'mt-1')} />
      </label>
      <label className="block text-xs text-muted-foreground">
        Mensagem (opcional)
        <textarea aria-label="Mensagem (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={cn(field, 'mt-1')} />
      </label>
      <label className="block text-xs text-muted-foreground">
        Arquivo
        <input aria-label="Arquivo" type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-foreground" />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!title.trim() || !file || send.isPending}>
          {send.isPending ? 'Enviando...' : 'Enviar para aprovação'}
        </Button>
      </div>
    </form>
  )
}

function ApprovalCard({ approval: a, canEdit, onChanged }: { approval: Approval; canEdit: boolean; onChanged: () => void }) {
  const [closing, setClosing] = useState(false)
  const badge = APPROVAL_BADGE[a.status]
  const decided = decisionText(a)
  return (
    <div className="rounded-lg bg-neutral-bg px-3 py-2.5 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{a.title}</p>
          <p className="text-xs text-muted-foreground">
            Pedido por {a.requestedByName} em {new Date(a.requestedAt).toLocaleDateString('pt-BR')} ·{' '}
            <a href={a.fileUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{a.fileName}</a>
          </p>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', badge.className)}>{badge.label}</span>
      </div>
      {a.message && <p className="text-xs text-foreground">{a.message}</p>}
      {decided && <p className="text-xs text-foreground">{decided}</p>}
      {a.decisionNote && <p className="text-xs text-muted-foreground italic">"{a.decisionNote}"</p>}
      {a.proofUrl && (
        <a href={a.proofUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Comprovante: {a.proofName}</a>
      )}
      {a.status === 'PENDING' && canEdit && !closing && (
        <button type="button" onClick={() => setClosing(true)} className="text-xs font-medium text-accent hover:underline">Fechar sem o portal</button>
      )}
      {closing && <CloseForm approvalId={a.id} onDone={() => { setClosing(false); onChanged() }} onCancel={() => setClosing(false)} />}
    </div>
  )
}

function CloseForm({ approvalId, onDone, onCancel }: { approvalId: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState<CloseReason | null>(null)
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const close = useMutation({
    mutationFn: () => {
      if (!proof) return api.post(`/approvals/${approvalId}/close`, { reason, note: note.trim() })
      const form = new FormData()
      form.append('reason', reason!)
      form.append('note', note.trim())
      form.append('file', proof)
      return api.post(`/approvals/${approvalId}/close`, form)
    },
    onSuccess: () => { toast.success('Fechamento registrado'); onDone() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao fechar a aprovação')),
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); close.mutate() }} className="mt-2 space-y-2 rounded-md border border-border bg-surface p-3">
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground mb-1">Como foi resolvido</legend>
        {(Object.keys(CLOSE_REASON_LABEL) as CloseReason[]).map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm text-foreground">
            <input type="radio" name={`reason-${approvalId}`} checked={reason === r} onChange={() => setReason(r)} aria-label={CLOSE_REASON_LABEL[r]} />
            {CLOSE_REASON_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs text-muted-foreground">
        Observação
        <textarea
          aria-label="Observação" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder={reason === 'NO_RESPONSE' ? 'Ex.: cobrado por WhatsApp em 10/11 e 12/11, sem retorno' : 'Ex.: aprovado por WhatsApp em 12/11 às 15h'}
          className={cn(field, 'mt-1')}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Print ou comprovante (opcional)
        <input aria-label="Print ou comprovante (opcional)" type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setProof(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs text-foreground" />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!reason || !note.trim() || close.isPending}>Registrar fechamento</Button>
      </div>
    </form>
  )
}
