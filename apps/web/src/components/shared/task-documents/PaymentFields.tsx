import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toApiAmount, toInputAmount } from '@/lib/money'

export interface PaymentValues {
  amount: string // API format "1234.56"
  paymentDueDate?: string // "YYYY-MM-DD"
}

// Amount + due date of a payment guide, typed in the Brazilian format. Used when delivering a guide,
// replacing its file and correcting it.
export function PaymentFields({ initialAmount, initialDueDate, submitLabel, pending, amountRequired = true, onSubmit, onCancel }: {
  initialAmount?: string | null
  initialDueDate?: string | null
  submitLabel: string
  pending?: boolean
  amountRequired?: boolean
  onSubmit: (values: Partial<PaymentValues>) => void
  onCancel: () => void
}) {
  const [valor, setValor] = useState(initialAmount ? toInputAmount(initialAmount) : '')
  const [vencimento, setVencimento] = useState(initialDueDate ? initialDueDate.slice(0, 10) : '')
  const [erro, setErro] = useState<string | null>(null)

  function submit() {
    if (!valor.trim()) {
      if (amountRequired) return setErro('Informe o valor da guia')
      return onSubmit({ paymentDueDate: vencimento || undefined })
    }
    try {
      onSubmit({ amount: toApiAmount(valor), paymentDueDate: vencimento || undefined })
    } catch {
      setErro('Valor inválido — use o formato 1.234,56')
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-surface p-2">
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Valor (R$)
          <Input value={valor} onChange={(e) => { setValor(e.target.value); setErro(null) }} placeholder="1.234,56" inputMode="decimal" className="h-8 w-32" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Vencimento
          <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="h-8 w-40" />
        </label>
      </div>
      {erro && <p className="text-xs text-danger-text">{erro}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? 'Enviando...' : submitLabel}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}
