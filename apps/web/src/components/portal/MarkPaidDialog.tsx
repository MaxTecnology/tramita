import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { toApiAmount, toInputAmount } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Client marks a payment guide as paid: amount pre-filled with the guide's, optional proof.
export function MarkPaidDialog({ protocolId, amount, open, onOpenChange, onDone }: {
  protocolId: string
  amount: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [valor, setValor] = useState(amount ? toInputAmount(amount) : '')
  const [proof, setProof] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const payMutation = useMutation({
    mutationFn: (apiAmount: string) => {
      if (!proof) return api.post(`/portal/protocols/${protocolId}/pay`, { amount: apiAmount })
      const form = new FormData()
      form.append('amount', apiAmount) // before the file: read from the same multipart stream
      form.append('file', proof)
      return api.post(`/portal/protocols/${protocolId}/pay`, form)
    },
    onSuccess: () => { toast.success('Guia marcada como paga'); onDone() },
    onError: (err) => toast.error(mensagemDeErro(err, 'Erro ao marcar como pago')),
  })

  function submit() {
    try {
      payMutation.mutate(toApiAmount(valor))
    } catch {
      setErro('Valor inválido — use o formato 1.234,56')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar como pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="paid-amount">Valor pago</Label>
            <Input
              id="paid-amount"
              value={valor}
              inputMode="decimal"
              onChange={(e) => { setValor(e.target.value); setErro(null) }}
            />
            {erro && <p className="text-xs text-danger-text">{erro}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="paid-proof">Anexar comprovante (opcional)</Label>
            <Input id="paid-proof" type="file" accept="application/pdf,image/*" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={payMutation.isPending}>
              {payMutation.isPending ? 'Enviando...' : 'Marcar como pago'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
