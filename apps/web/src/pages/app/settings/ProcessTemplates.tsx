import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, ClipboardList, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { ProcessTemplate } from '@/types'
import { askConfirm } from '@/components/ui/app-dialogs'

export default function ProcessTemplates() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: templates = [], isLoading } = useQuery<ProcessTemplate[]>({
    queryKey: ['process-templates'],
    queryFn: () => api.get('/process-templates').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/process-templates/${id}`),
    onSuccess: () => {
      toast.success('Modelo removido')
      qc.invalidateQueries({ queryKey: ['process-templates'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao remover modelo')
    },
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-bold text-foreground">Modelos de Processo</h1>
          <Button onClick={() => navigate('/app/settings/process-templates/new')} className="gap-2">
            <Plus size={16} />
            Novo template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <ClipboardList size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum modelo de processo cadastrado</p>
          <p className="text-xs mt-1">Crie um modelo pra padronizar as etapas de um processo (ex: Legalização, Fiscal).</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                  {!t.isActive && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.columns.length} coluna{t.columns.length !== 1 ? 's' : ''}
                  {t.description ? ` · ${t.description}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Link to={`/app/settings/process-templates/${t.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </Link>
                <button
                  onClick={async () => { if (await askConfirm({ title: `Excluir o modelo "${t.name}"?`, confirmLabel: 'Excluir', danger: true })) deleteMutation.mutate(t.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
