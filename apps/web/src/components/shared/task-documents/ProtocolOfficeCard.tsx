import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { UPLOAD_ACCEPT } from '@/lib/upload'
import { cn, mensagemDeErro } from '@/lib/utils'
import { formatBRL } from '@/lib/money'
import { formatDateOnlyUTC } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import type { Protocol } from '@/types'
import { PaymentFields, type PaymentValues } from './PaymentFields'

const STATUS_LABEL: Record<Protocol['status'], string> = {
  SENT: 'Não visto',
  VIEWED: 'Visto',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Vencido sem visualização',
}

// One sent document in the task's "Protocolos" tab, with the office actions: replace the file
// (standard correction), correct amount/due date, cancel (exception, with a reason).
export function ProtocolOfficeCard({ protocol: p, taskId, onReceipt }: {
  protocol: Protocol
  taskId: string
  onReceipt: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'idle' | 'edit' | 'replace'>('idle')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['protocols', taskId] })
    queryClient.invalidateQueries({ queryKey: ['task-documents', taskId] })
    queryClient.invalidateQueries({ queryKey: ['unpaid-guides'] })
    queryClient.invalidateQueries({ queryKey: ['unpaid-guides-summary'] })
  }
  const locked = !!p.paidAt || !!p.cancelledAt

  const replaceMutation = useMutation({
    mutationFn: ({ file, values }: { file: File; values: Partial<PaymentValues> }) => {
      const form = new FormData()
      if (values.amount) form.append('amount', values.amount)
      if (values.paymentDueDate) form.append('paymentDueDate', values.paymentDueDate)
      form.append('file', file)
      return api.post(`/protocols/${p.id}/replace`, form)
    },
    onSuccess: () => { toast.success('Documento substituído — o cliente foi avisado'); setMode('idle'); setPendingFile(null); refresh() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao substituir documento')),
  })
  const editMutation = useMutation({
    mutationFn: (values: Partial<PaymentValues>) => api.patch(`/protocols/${p.id}/payment`, { amount: values.amount, dueDate: values.paymentDueDate }),
    onSuccess: () => { toast.success('Guia corrigida'); setMode('idle'); refresh() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao corrigir guia')),
  })
  const cancelMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/protocols/${p.id}/cancel`, { reason }),
    onSuccess: () => { toast.success('Documento cancelado'); refresh() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao cancelar documento')),
  })

  return (
    <div className={cn('rounded-lg border border-border p-3', p.cancelledAt && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground truncate">{p.number} — {p.title}</p>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-bg text-muted-foreground whitespace-nowrap">
          {p.cancelledAt ? 'Cancelado' : STATUS_LABEL[p.status]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {p.dueDate && <span>Vencimento: {formatDateOnlyUTC(p.dueDate)}</span>}
        {p.requiresPayment && p.amount && <span className="font-medium text-foreground">{formatBRL(p.amount)}</span>}
        {p.requiresPayment && !p.cancelledAt && (
          p.paidAt
            ? <span className="text-success-text">Pago pelo cliente em {new Date(p.paidAt).toLocaleDateString('pt-BR')}</span>
            : <span className="text-warning-text">Não pago</span>
        )}
        {p.fileUpdatedAt && <span>Atualizado em {new Date(p.fileUpdatedAt).toLocaleDateString('pt-BR')}</span>}
      </div>
      {p.cancelledAt && p.cancellationReason && (
        <p className="mt-1 text-xs text-danger-text">Cancelado: {p.cancellationReason}</p>
      )}

      <div className="mt-1 flex flex-wrap gap-3">
        <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs text-accent-hover hover:underline" onClick={() => onReceipt(p.id)}>
          Ver comprovante
        </Button>
        {!locked && (
          <>
            <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs text-accent-hover hover:underline" onClick={() => fileRef.current?.click()}>
              Substituir arquivo
            </Button>
            {p.requiresPayment && (
              <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs text-accent-hover hover:underline" onClick={() => setMode('edit')}>
                Corrigir valor/vencimento
              </Button>
            )}
            <Button
              type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs text-danger-text hover:underline"
              onClick={() => {
                const reason = window.prompt('Motivo do cancelamento (o documento sai da visão do cliente):')
                if (reason && reason.trim().length >= 3) cancelMutation.mutate(reason.trim())
              }}
            >
              Cancelar envio
            </Button>
          </>
        )}
        {p.paidAt && <span className="text-xs text-muted-foreground">Para alterar, o cliente precisa desfazer o pagamento.</span>}
      </div>
      <input
        ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          if (p.requiresPayment) { setPendingFile(file); setMode('replace') } else replaceMutation.mutate({ file, values: {} })
        }}
      />

      {mode === 'edit' && (
        <PaymentFields
          initialAmount={p.amount} initialDueDate={p.dueDate} submitLabel="Salvar"
          pending={editMutation.isPending} onSubmit={(v) => editMutation.mutate(v)} onCancel={() => setMode('idle')}
        />
      )}
      {mode === 'replace' && pendingFile && (
        <PaymentFields
          initialAmount={p.amount} initialDueDate={p.dueDate} submitLabel={`Substituir por ${pendingFile.name}`} amountRequired={false}
          pending={replaceMutation.isPending}
          onSubmit={(v) => replaceMutation.mutate({ file: pendingFile, values: v })}
          onCancel={() => { setMode('idle'); setPendingFile(null) }}
        />
      )}
    </div>
  )
}
