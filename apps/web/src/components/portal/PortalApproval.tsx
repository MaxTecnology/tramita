import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { APPROVAL_BADGE, decisionText, type Approval } from '@/components/shared/approvals'

// Client side of one approval request: the file, the message and Aprovar · Pedir ajuste
export function PortalApproval({ approval: a, onChanged }: { approval: Approval; onChanged: () => void }) {
  const [askingChanges, setAskingChanges] = useState(false)
  const [note, setNote] = useState('')
  const badge = APPROVAL_BADGE[a.status]
  const decided = decisionText(a)

  const approve = useMutation({
    mutationFn: () => api.post(`/portal/approvals/${a.id}/approve`, {}),
    onSuccess: () => { toast.success('Aprovado'); onChanged() },
    onError: (err) => { toast.error(mensagemDeErro(err, 'Erro ao aprovar')); onChanged() },
  })
  const requestChanges = useMutation({
    mutationFn: () => api.post(`/portal/approvals/${a.id}/request-changes`, { note: note.trim() }),
    onSuccess: () => { toast.success('Pedido de ajuste enviado ao escritório'); setAskingChanges(false); onChanged() },
    onError: (err) => { toast.error(mensagemDeErro(err, 'Erro ao pedir ajuste')); onChanged() },
  })
  const busy = approve.isPending || requestChanges.isPending

  return (
    <div className={cn('px-4 py-3 space-y-1.5', a.status === 'PENDING' && 'bg-warning-bg/40')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{a.title}</p>
          <a href={a.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">{a.fileName}</a>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', badge.className)}>
          {a.status === 'PENDING' ? 'Aguardando sua aprovação' : badge.label}
        </span>
      </div>
      {a.message && <p className="text-xs text-foreground">{a.message}</p>}
      {decided && <p className="text-xs text-foreground">{decided}</p>}
      {a.decisionNote && <p className="text-xs text-muted-foreground italic">"{a.decisionNote}"</p>}

      {a.status === 'PENDING' && a.taskClosed && (
        <p className="text-xs text-muted-foreground">A tarefa foi encerrada pelo escritório — não é mais preciso responder.</p>
      )}
      {a.status === 'PENDING' && !a.taskClosed && !askingChanges && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => approve.mutate()} disabled={busy}>Aprovar</Button>
          <Button size="sm" variant="outline" onClick={() => setAskingChanges(true)} disabled={busy}>Pedir ajuste</Button>
        </div>
      )}
      {a.status === 'PENDING' && !a.taskClosed && askingChanges && (
        <form onSubmit={(e) => { e.preventDefault(); requestChanges.mutate() }} className="space-y-2 pt-1">
          <label className="block text-xs text-muted-foreground">
            O que precisa ser ajustado
            <textarea
              aria-label="O que precisa ser ajustado" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              className="mt-1 w-full rounded-md border border-border bg-surface text-foreground text-sm px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!note.trim() || busy}>Enviar pedido de ajuste</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAskingChanges(false)}>Cancelar</Button>
          </div>
        </form>
      )}
    </div>
  )
}
