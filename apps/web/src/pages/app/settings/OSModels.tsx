import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { EditLink, ListTable, StatusTag } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { SearchField } from '@/components/ui/search-field'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { OSModel } from '@/types'

function usage(m: OSModel): string {
  if (m.usableStandalone && m.usableInProcess) return 'Avulsa e em processos'
  if (m.usableStandalone) return 'Só avulsa'
  if (m.usableInProcess) return 'Só em processos'
  return 'Não está em uso'
}

// Configurações › Modelos de OS
export default function OSModels() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: models = [], isLoading } = useQuery<OSModel[]>({
    queryKey: ['os-models'],
    queryFn: () => api.get('/os-models').then((r) => r.data),
  })
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim()
    return q ? models.filter((m) => m.name.toLowerCase().includes(q)) : models
  }, [models, search])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/os-models/${id}`),
    onSuccess: () => { toast.success('Modelo de OS excluído (ou desativado, se já foi usado)'); qc.invalidateQueries({ queryKey: ['os-models'] }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível excluir o modelo')),
  })

  async function remove(m: OSModel) {
    const ok = await askConfirm({
      title: `Excluir o modelo "${m.name}"?`,
      description: 'Se já foi usado em alguma OS, ele é desativado em vez de apagado (o histórico continua).',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (ok) deleteMutation.mutate(m.id)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Modelos de OS"
        description="Cada serviço avulso do escritório: documentos pedidos e entregues, prazo interno e conferência do robô."
        actions={<Button onClick={() => navigate('/app/settings/os-models/new')} className="gap-1.5"><Plus size={16} aria-hidden /> Novo modelo</Button>}
      />
      {models.length > 0 && <SearchField className="mb-3 max-w-sm" label="Buscar modelos de OS" value={search} onChange={setSearch} placeholder="Buscar pelo nome" />}
      <ListTable<OSModel>
        label="Modelos de OS"
        loading={isLoading}
        rows={shown}
        rowKey={(m) => m.id}
        muted={(m) => !m.isActive}
        columns={[
          {
            header: 'Serviço', width: 'minmax(0,2fr)',
            cell: (m) => (
              <span className="block min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                  {!m.isActive && <StatusTag>Inativo</StatusTag>}
                </span>
                {m.description && <span className="block truncate text-xs text-muted-foreground">{m.description}</span>}
              </span>
            ),
          },
          { header: 'Onde é usada', width: 'minmax(0,1.3fr)', cell: (m) => <span className="text-sm text-foreground">{usage(m)}</span> },
          {
            header: 'Prazo interno', width: 'minmax(0,1fr)',
            cell: (m) => <span className="text-sm text-foreground">{m.deadlineBusinessDays ? `${m.deadlineBusinessDays} dias úteis` : 'Sem prazo interno'}</span>,
          },
          {
            header: 'Robô', width: 'minmax(0,1.2fr)',
            cell: (m) => m.documentDeliveries.some((d) => d.obligationTypeId)
              ? <span className="text-sm text-foreground">Robô confere a entrega</span>
              : <span className="text-sm text-muted-foreground">Sem robô</span>,
          },
        ]}
        actions={(m) => (
          <>
            <EditLink to={`/app/settings/os-models/${m.id}/edit`} name={m.name} />
            <ActionMenu label={`Mais ações de ${m.name}`} items={[{ label: 'Excluir', onSelect: () => void remove(m), danger: true }]} />
          </>
        )}
        empty={search ? <p className="text-sm text-muted-foreground">Nenhum modelo com esse nome.</p> : (
          <div className="flex flex-col items-center gap-2">
            <ListChecks size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Crie um modelo para cada serviço avulso, como recálculo de DAS ou certidão negativa.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/os-models/new')}>Criar o primeiro modelo</Button>
          </div>
        )}
      />
    </div>
  )
}
