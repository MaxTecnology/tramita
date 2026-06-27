import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Plus, Inbox } from 'lucide-react'
import type { ClientRequest } from '@/types'
import { toast } from 'sonner'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
  CANCELLED: 'Cancelada',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export default function PortalRequests() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '' })

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['portal-requests'],
    queryFn: () => api.get('/portal/requests').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/portal/requests', form).then((r) => r.data),
    onSuccess: () => {
      toast.success('Solicitação enviada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
      setOpen(false)
      setForm({ title: '', description: '' })
    },
    onError: () => toast.error('Erro ao enviar solicitação'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/portal/requests/${id}/cancel`),
    onSuccess: () => {
      toast.success('Solicitação cancelada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
    },
    onError: () => toast.error('Erro ao cancelar'),
  })

  if (isLoading) return <div className="p-6 text-gray-500 text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Minhas Solicitações</h1>
        <Button onClick={() => setOpen(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2">
          <Plus size={16} />
          Nova solicitação
        </Button>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma solicitação ainda</p>
          <p className="text-xs mt-1">Use o botão acima para pedir algo ao seu escritório.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  {r.description && <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>}
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <p className="text-xs text-red-500 mt-1 italic">Motivo: {r.rejectionReason}</p>
                  )}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status === 'PENDING' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (window.confirm('Cancelar esta solicitação?')) cancelMutation.mutate(r.id) }}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-2 -ml-2"
                >
                  Cancelar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nova solicitação</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) createMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Título</Label>
              <Input
                id="req-title"
                placeholder="Ex: Preciso de uma certidão atualizada"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-desc">Descrição</Label>
              <textarea
                id="req-desc"
                rows={4}
                placeholder="Detalhe o que você precisa..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>
            {createMutation.isError && <p className="text-sm text-red-600">Erro ao enviar. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || !form.title.trim()} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                {createMutation.isPending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
