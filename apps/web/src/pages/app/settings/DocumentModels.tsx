// apps/web/src/pages/app/settings/DocumentModels.tsx
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Plus, Pencil, Trash2, FileText, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { mensagemDeErro } from '@/lib/utils'
import type { DocumentModelListItem } from '@/types'

export default function DocumentModels() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: modelos = [], isLoading } = useQuery<DocumentModelListItem[]>({
    queryKey: ['document-models'],
    queryFn: () => api.get('/document-reader/modelos').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/document-reader/modelos/${id}`),
    onSuccess: () => { toast.success('Modelo arquivado'); qc.invalidateQueries({ queryKey: ['document-models'] }) },
    onError: (err: unknown) => toast.error(mensagemDeErro(err, 'Erro ao arquivar modelo')),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Configurações
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-lg md:text-xl font-bold text-foreground">Modelos de Documento</h1>
          <Button onClick={() => navigate('/app/settings/document-models/new')} className="gap-2">
            <Plus size={16} />
            Novo modelo
          </Button>
        </div>
      </div>

      {modelos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <FileText size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum modelo cadastrado</p>
          <p className="text-xs mt-1">Crie um modelo marcando um PDF de amostra pra o robô reconhecer esse layout.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {modelos.map((m) => (
            <Card key={m.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{m.nome}</span>
                  {m.isGlobal && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">AutoHubs</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{m.obligationType.name} · versão {m.version}</p>
              </div>
              {!m.isGlobal && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Link to={`/app/settings/document-models/${m.id}/edit`} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                    <Pencil size={14} />
                  </Link>
                  <button
                    onClick={() => { if (window.confirm(`Arquivar o modelo "${m.nome}"?`)) deleteMutation.mutate(m.id) }}
                    className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                    aria-label="Arquivar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
