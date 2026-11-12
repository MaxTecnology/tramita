import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// New delivery on a task: name + "Exige pagamento" (payment guide → paid/unpaid in the client portal)
export function AddDeliverableForm({ pending, onSubmit, onCancel }: {
  pending?: boolean
  onSubmit: (v: { name: string; requiresPayment: boolean }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [requiresPayment, setRequiresPayment] = useState(false)
  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-surface p-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do documento (ex.: Guia DAS)" className="h-8" autoFocus />
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={requiresPayment} onChange={(e) => setRequiresPayment(e.target.checked)} />
        Exige pagamento (guia)
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !name.trim()} onClick={() => onSubmit({ name: name.trim(), requiresPayment })}>Adicionar</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}
