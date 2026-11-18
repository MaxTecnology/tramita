import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileStack, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { EditLink, ListTable, StatusTag } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { ProcessTemplate } from '@/types'

// Configurações › Modelos de processo
export default function ProcessTemplates() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: templates = [], isLoading } = useQuery<ProcessTemplate[]>({
    queryKey: ['process-templates'],
    queryFn: () => api.get('/process-templates').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/process-templates/${id}`),
    onSuccess: () => { toast.success('Modelo de processo excluído'); qc.invalidateQueries({ queryKey: ['process-templates'] }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível excluir o modelo')),
  })

  async function remove(t: ProcessTemplate) {
    const ok = await askConfirm({ title: `Excluir o modelo "${t.name}"?`, description: 'Processos já abertos com ele continuam.', confirmLabel: 'Excluir', danger: true })
    if (ok) deleteMutation.mutate(t.id)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Modelos de processo"
        description="Etapas e OS de cada tipo de processo (abertura de empresa, alteração contratual): o processo aberto já nasce com elas."
        actions={<Button onClick={() => navigate('/app/settings/process-templates/new')} className="gap-1.5"><Plus size={16} aria-hidden /> Novo modelo</Button>}
      />
      <ListTable<ProcessTemplate>
        label="Modelos de processo"
        loading={isLoading}
        rows={templates}
        rowKey={(t) => t.id}
        muted={(t) => !t.isActive}
        columns={[
          {
            header: 'Processo', width: 'minmax(0,2fr)',
            cell: (t) => (
              <span className="block min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                  {!t.isActive && <StatusTag>Inativo</StatusTag>}
                </span>
                {t.description && <span className="block truncate text-xs text-muted-foreground">{t.description}</span>}
              </span>
            ),
          },
          {
            header: 'Estrutura', width: 'minmax(0,1.2fr)',
            cell: (t) => <span className="text-sm text-foreground">{t.columns.length} {t.columns.length === 1 ? 'etapa' : 'etapas'}, {t.items.length} OS</span>,
          },
          { header: 'Prazo interno', width: 'minmax(0,1fr)', cell: (t) => <span className="text-sm text-foreground">{t.deadlineBusinessDays ? `${t.deadlineBusinessDays} dias úteis` : 'Sem prazo interno'}</span> },
          { header: 'Cliente solicita', width: 'minmax(0,0.9fr)', cell: (t) => <span className="text-sm text-foreground">{t.clientCanRequest ? 'Sim' : 'Não'}</span> },
        ]}
        actions={(t) => (
          <>
            <EditLink to={`/app/settings/process-templates/${t.id}/edit`} name={t.name} />
            <ActionMenu label={`Mais ações de ${t.name}`} items={[{ label: 'Excluir', onSelect: () => void remove(t), danger: true }]} />
          </>
        )}
        empty={(
          <div className="flex flex-col items-center gap-2">
            <FileStack size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Monte o primeiro tipo de processo com as etapas e as OS que ele sempre tem.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/process-templates/new')}>Criar o primeiro modelo</Button>
          </div>
        )}
      />
    </div>
  )
}
