import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { EditLink, ListTable } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { DocumentModelListItem } from '@/types'

// Configurações › Modelos de documento (robot layouts). System models (AutoHubs) are read-only here.
export default function DocumentModels() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: models = [], isLoading } = useQuery<DocumentModelListItem[]>({
    queryKey: ['document-models'],
    queryFn: () => api.get('/document-reader/modelos').then((r) => r.data),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/document-reader/modelos/${id}`),
    onSuccess: () => { toast.success('Modelo arquivado'); qc.invalidateQueries({ queryKey: ['document-models'] }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível arquivar o modelo')),
  })

  async function archive(m: DocumentModelListItem) {
    const ok = await askConfirm({ title: `Arquivar o modelo "${m.nome}"?`, description: 'O robô deixa de usar este layout para reconhecer documentos.', confirmLabel: 'Arquivar', danger: true })
    if (ok) archiveMutation.mutate(m.id)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Modelos de documento"
        description="Layouts que o robô reconhece ao ler guias e declarações. Os padrões do sistema já vêm prontos; crie os do escritório marcando um PDF de amostra."
        actions={<Button onClick={() => navigate('/app/settings/document-models/new')} className="gap-1.5"><Plus size={16} aria-hidden /> Novo modelo</Button>}
      />
      <ListTable<DocumentModelListItem>
        label="Modelos de documento"
        loading={isLoading}
        rows={models}
        rowKey={(m) => m.id}
        columns={[
          { header: 'Modelo', width: 'minmax(0,2fr)', cell: (m) => <span className="block truncate text-sm font-medium text-foreground">{m.nome}</span> },
          { header: 'Obrigação', width: 'minmax(0,1.8fr)', cell: (m) => <span className="text-sm text-foreground">{m.obligationType.name}</span> },
          { header: 'Versão', width: 'minmax(0,0.5fr)', cell: (m) => <span className="text-sm text-foreground">{m.version}</span> },
          {
            header: 'Origem', width: 'minmax(0,1fr)',
            cell: (m) => m.isGlobal
              ? <span className="rounded bg-info-bg px-1.5 py-0.5 text-xs text-info-text" title="Mantido pela AutoHubs; não é editável aqui">Padrão do sistema</span>
              : <span className="text-sm text-foreground">Do escritório</span>,
          },
        ]}
        actions={(m) => m.isGlobal ? null : (
          <>
            <EditLink to={`/app/settings/document-models/${m.id}/edit`} name={m.nome} />
            <ActionMenu label={`Mais ações de ${m.nome}`} items={[{ label: 'Arquivar', onSelect: () => void archive(m), danger: true }]} />
          </>
        )}
        empty={(
          <div className="flex flex-col items-center gap-2">
            <FileText size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Marque um PDF de amostra para o robô aprender a reconhecer esse layout.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/document-models/new')}>Criar o primeiro modelo</Button>
          </div>
        )}
      />
    </div>
  )
}
