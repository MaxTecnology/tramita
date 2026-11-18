import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { cn, mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { DelayReason } from '@/types'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'

// Reasons the office picks when an OS or process finishes after its internal deadline
export default function DelayReasons() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const { data: reasons = [], isLoading } = useQuery<DelayReason[]>({ queryKey: ['delay-reasons'], queryFn: () => api.get('/delay-reasons').then((r) => r.data) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['delay-reasons'] })

  const add = useMutation({
    mutationFn: () => api.post('/delay-reasons', { name: name.trim(), requiresNote: false }),
    onSuccess: () => { toast.success('Motivo adicionado'); setName(''); refresh() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao adicionar motivo')),
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<DelayReason, 'requiresNote' | 'isActive'>> }) => api.patch(`/delay-reasons/${id}`, body),
    onSuccess: refresh,
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao salvar motivo')),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/delay-reasons/${id}`),
    onSuccess: () => { toast.success('Motivo removido (ou desativado, se já foi usado)'); refresh() },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao remover motivo')),
  })

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Motivos de atraso"
        description="Lista que aparece para a pessoa escolher quando conclui uma OS ou processo depois do prazo interno (o tempo esperando o cliente não conta)."
      />

      <Card className="p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate() }}>
          <Input aria-label="Novo motivo" placeholder="Ex.: Sistema da prefeitura fora do ar" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={add.isPending} className="flex-shrink-0 whitespace-nowrap">Adicionar motivo</Button>
        </form>
      </Card>

      {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
        <Card className="divide-y divide-border">
          {reasons.map((r) => (
            <div key={r.id} className={cn('flex items-center gap-3 px-4 py-2.5', !r.isActive && 'opacity-60')}>
              <span className="text-sm text-foreground flex-1">{r.name}{!r.isActive && ' (inativo)'}</span>
              <span className="text-xs text-muted-foreground">Pede observação</span>
              <button
                type="button" role="switch" aria-checked={r.requiresNote} aria-label={`Pede observação: ${r.name}`}
                onClick={() => update.mutate({ id: r.id, body: { requiresNote: !r.requiresNote } })}
                className={cn('relative h-5 w-9 rounded-full transition-colors', r.requiresNote ? 'bg-accent' : 'bg-border')}
              >
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', r.requiresNote ? 'left-[1.125rem]' : 'left-0.5')} />
              </button>
              <button
                onClick={async () => { if (await askConfirm({ title: `Remover o motivo "${r.name}"?`, confirmLabel: 'Remover', danger: true })) remove.mutate(r.id) }}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text" aria-label={`Remover ${r.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
