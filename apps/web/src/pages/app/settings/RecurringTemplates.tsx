import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { mensagemDeErro } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageHeader, SETTINGS_BACK } from '@/components/ui/page-header'
import { ListTable } from '@/components/ui/list-table'
import { ActionMenu } from '@/components/ui/action-menu'
import { SearchField } from '@/components/ui/search-field'
import { askConfirm } from '@/components/ui/app-dialogs'
import type { FailedGeneration, RecurringTaskTemplate } from '@/types'

type Row = RecurringTaskTemplate & { assignmentsCount?: number }

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal', MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', ANNUAL: 'Anual',
}
const WEEKDAY = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function calendar(t: Row): string {
  const due = t.periodicity === 'WEEKLY' ? `vence ${WEEKDAY[t.dueDayOfPeriod] ?? `dia ${t.dueDayOfPeriod}`}` : `vence dia ${t.dueDayOfPeriod}`
  return `${PERIODICITY_LABEL[t.periodicity]}, ${due}`
}

function scope(t: Row): string {
  if (t.dueScope === 'FEDERAL' || !t.dueScope) return 'Federal'
  const n = t.dueRules?.length ?? 0
  const label = t.dueScope === 'STATE' ? 'Estadual' : 'Municipal'
  return n > 0 ? `${label} (${n} ${n === 1 ? 'exceção' : 'exceções'})` : label
}

export default function RecurringTemplates() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: templates = [], isLoading } = useQuery<Row[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })
  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
  })
  const failuresByTemplate = useMemo(() => {
    const map = new Map<string, number>()
    for (const f of failures) map.set(f.templateId, (map.get(f.templateId) ?? 0) + 1)
    return map
  }, [failures])

  const shown = useMemo(() => {
    const q = search.toLowerCase().trim()
    return q ? templates.filter((t) => t.title.toLowerCase().includes(q)) : templates
  }, [templates, search])

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recurring-templates/${id}`),
    onSuccess: () => { toast.success('Tarefa recorrente excluída'); qc.invalidateQueries({ queryKey: ['recurring-templates'] }) },
    onError: (err) => toast.error(mensagemDeErro(err, 'Não foi possível excluir')),
  })

  async function remove(t: Row) {
    const ok = await askConfirm({
      title: `Excluir "${t.title}"?`,
      description: 'As tarefas já geradas continuam. Só é possível excluir sem clientes vinculados.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (ok) deleteMutation.mutate(t.id)
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <PageHeader
        back={SETTINGS_BACK}
        title="Tarefas recorrentes"
        description="Obrigações que o Tramita gera sozinho para cada cliente vinculado, no mês, trimestre ou ano."
        actions={<Button onClick={() => navigate('/app/settings/recurring-templates/new')} className="gap-1.5"><Plus size={16} aria-hidden /> Nova tarefa recorrente</Button>}
      />
      {templates.length > 0 && (
        <SearchField className="mb-3 max-w-sm" label="Buscar tarefas recorrentes" value={search} onChange={setSearch} placeholder="Buscar pelo nome" />
      )}
      <ListTable<Row>
        label="Tarefas recorrentes"
        loading={isLoading}
        rows={shown}
        rowKey={(t) => t.id}
        muted={(t) => !t.isActive}
        columns={[
          {
            header: 'Recorrência', width: 'minmax(0,2fr)',
            cell: (t) => (
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                {!t.isActive && <span className="rounded bg-neutral-bg px-1.5 py-0.5 text-xs text-muted-foreground">Inativa</span>}
              </span>
            ),
          },
          { header: 'Calendário', width: 'minmax(0,1.4fr)', cell: (t) => <span className="text-sm text-foreground">{calendar(t)}</span> },
          { header: 'Departamento', width: 'minmax(0,1fr)', cell: (t) => <span className="text-sm text-foreground">{t.department.name}</span> },
          { header: 'Abrangência', width: 'minmax(0,1.2fr)', cell: (t) => <span className="text-sm text-foreground">{scope(t)}</span> },
          {
            header: 'Clientes', width: 'minmax(0,1fr)',
            cell: (t) => {
              const failed = failuresByTemplate.get(t.id) ?? 0
              const count = t.assignmentsCount ?? 0
              return (
                <span className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                  {count} {count === 1 ? 'cliente' : 'clientes'}
                  {failed > 0 && <span className="rounded bg-danger-bg px-1.5 py-0.5 text-xs text-danger-text">{failed} {failed === 1 ? 'falha' : 'falhas'}</span>}
                </span>
              )
            },
          },
        ]}
        actions={(t) => (
          <>
            <Link
              to={`/app/settings/recurring-templates/${t.id}/manage`}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Vínculos e geração
            </Link>
            <ActionMenu
              label={`Mais ações de ${t.title}`}
              items={[
                { label: 'Editar', onSelect: () => navigate(`/app/settings/recurring-templates/${t.id}/edit`) },
                { label: 'Excluir', onSelect: () => void remove(t), danger: true, separated: true },
              ]}
            />
          </>
        )}
        empty={search ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa recorrente com esse nome.</p>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Repeat size={28} aria-hidden className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Cadastre as obrigações do mês (folha, DAS, ICMS) para o Tramita gerar as tarefas sozinho.</p>
            <Button size="sm" onClick={() => navigate('/app/settings/recurring-templates/new')}>Cadastrar a primeira</Button>
          </div>
        )}
      />
    </div>
  )
}
