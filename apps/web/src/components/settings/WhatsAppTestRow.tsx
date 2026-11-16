import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Sends one WhatsApp through the saved MaximizeBot token, so the office sees right away whether the
// integration works (the API answers the provider's own reason when it refuses)
export function WhatsAppTestRow({ hasSavedToken }: { hasSavedToken: boolean }) {
  const [number, setNumber] = useState('')
  const test = useMutation({
    mutationFn: () => api.post('/notifications/config/test-whatsapp', { number }),
    onSuccess: () => { toast.success('WhatsApp de teste enviado'); setNumber('') },
  })
  return (
    <div className="space-y-1">
      <Label htmlFor="test-whatsapp-number">Enviar WhatsApp de teste</Label>
      <div className="flex gap-2">
        <Input id="test-whatsapp-number" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="(82) 99999-1234" />
        <Button type="button" variant="outline" aria-label="Testar WhatsApp"
          disabled={!hasSavedToken || number.replace(/\D/g, '').length < 10 || test.isPending}
          onClick={() => test.mutate()} className="flex items-center gap-1.5 flex-shrink-0">
          <Send size={14} />
          {test.isPending ? 'Enviando...' : 'Testar'}
        </Button>
      </div>
      {!hasSavedToken && <p className="text-xs text-muted-foreground">Salve o token antes de testar.</p>}
      {test.isError && <p className="text-xs text-danger-text">{mensagemDeErro(test.error, 'Erro ao enviar o WhatsApp de teste')}</p>}
    </div>
  )
}
