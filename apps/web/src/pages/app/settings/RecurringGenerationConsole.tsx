import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { MonthYearPicker } from '@/components/shared/MonthYearPicker'
import type { RecurringTaskTemplate, RecurringTaskAssignment, BulkGenerationResult, BulkGenerationSummary, FailedGeneration } from '@/types'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal', MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', ANNUAL: 'Anual',
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthValueToISO(monthValue: string): string {
  return new Date(`${monthValue}-01T00:00:00.000Z`).toISOString()
}

export default function RecurringGenerationConsole() {
  const qc = useQueryClient()
  const [dueMonth, setDueMonth] = useState(currentMonthValue())
  const [lastRun, setLastRun] = useState<BulkGenerationSummary[] | null>(null)

  const { data: templates = [] } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })
  const activeTemplates = templates.filter((t) => t.isActive)

  const { data: failures = [] } = useQuery<FailedGeneration[]>({
    queryKey: ['recurring-failed-generations'],
    queryFn: () => api.get('/recurring-templates/failed-generations').then((r) => r.data),
  })

  const failuresByTemplate = failures.reduce<Record<string, { title: string; items: FailedGeneration[] }>>((acc, f) => {
    if (!acc[f.templateId]) acc[f.templateId] = { title: f.templateTitle, items: [] }
    acc[f.templateId].items.push(f)
    return acc
  }, {})

  const runAllMutation = useMutation({
    mutationFn: () => api.post<BulkGenerationSummary[]>('/recurring-templates/bulk-generate', { dueMonth: monthValueToISO(dueMonth) }).then((r) => r.data),
    onSuccess: (summaries) => {
      setLastRun(summaries)
      const totalGenerated = summaries.reduce((acc, s) => acc + s.result.generated, 0)
      const totalFailed = summaries.reduce((acc, s) => acc + s.result.failed.length, 0)
      const message = `${totalGenerated} tarefas geradas em ${summaries.length} templates, ${totalFailed} falharam`
      if (totalFailed > 0) {
        toast.error(message)
      } else {
        toast.success(message)
      }
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar em lote')
    },
  })

  const retryMutation = useMutation({
    mutationFn: async (failure: FailedGeneration) => {
      // Essa tela cruza vários templates, então não tem como pré-carregar os vínculos de todos —
      // busca os assignments do template da falha sob demanda, só quando o operador clica.
      const assignments = await api.get<RecurringTaskAssignment[]>(`/recurring-templates/${failure.templateId}/assignments`).then((r) => r.data)
      const assignmentIds = assignments.filter((a) => a.clientId === failure.clientId).map((a) => a.id)
      return api.post<BulkGenerationResult>(`/recurring-templates/${failure.templateId}/assignments/bulk-generate`, {
        dueMonth: failure.dueMonth,
        assignmentIds,
      }).then((r) => r.data)
    },
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toast.error(`Ainda falhou: ${result.failed[0]?.errorMessage ?? 'motivo desconhecido'}`)
      } else if (result.generated > 0 || result.alreadyExists > 0) {
        toast.success('Tentativa de nova geração enviada')
      } else {
        toast.error('Nenhum vínculo encontrado pra essa falha — verifique se o cliente ainda está vinculado')
      }
      qc.invalidateQueries({ queryKey: ['recurring-failed-generations'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao tentar gerar novamente')
    },
  })

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/app/settings" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">Geração manual</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Ferramenta de exceção — recuperar uma geração que o cron não fez, ou adiantar um mês inteiro antes do disparo automático. Roda todos os templates ativos de uma vez.
      </p>

      {Object.keys(failuresByTemplate).length > 0 && (
        <Card className="border-danger-text bg-danger-bg px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-danger-text font-medium text-sm">
            <AlertTriangle size={16} />
            Falhas pendentes
          </div>
          {Object.entries(failuresByTemplate).map(([templateId, { title, items }]) => (
            <div key={templateId} className="text-xs">
              <Link to={`/app/settings/recurring-templates/${templateId}/manage`} className="underline font-medium text-danger-text">{title}</Link>
              <ul className="mt-1 space-y-1 pl-2">
                {items.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-danger-text">
                    <span>{f.clientName} — competência {new Date(f.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} — {f.errorMessage}</span>
                    {f.retryable ? (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate(f)}
                        disabled={retryMutation.isPending}
                        className="underline hover:no-underline flex-shrink-0 ml-2"
                      >
                        Gerar novamente
                      </button>
                    ) : (
                      <span className="flex-shrink-0 ml-2 text-right italic">
                        Cliente não vinculado — vincule de novo pra poder gerar
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      )}

      <Card className="px-4 py-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="block">Mês de vencimento</Label>
          <MonthYearPicker value={dueMonth} onChange={setDueMonth} />
        </div>

        <div className="space-y-1">
          {activeTemplates.map((t) => (
            <div key={t.id} className="text-sm bg-neutral-bg rounded px-2 py-1.5">
              {t.title} — {PERIODICITY_LABEL[t.periodicity]} · {t.department.name}
            </div>
          ))}
          {activeTemplates.length === 0 && <p className="text-xs text-muted-foreground">Nenhum template ativo.</p>}
        </div>

        <Button type="button" onClick={() => runAllMutation.mutate()} disabled={activeTemplates.length === 0 || runAllMutation.isPending}>
          {runAllMutation.isPending ? 'Gerando...' : 'Gerar todos'}
        </Button>
      </Card>

      {lastRun && (
        <Card className="px-4 py-3 space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Resultado da última execução</Label>
          {lastRun.map((s) => (
            <div key={s.templateId} className="text-xs bg-neutral-bg rounded px-2 py-1.5">
              <span className="font-medium">{s.templateTitle}</span> — {s.result.generated} geradas, {s.result.alreadyExists} já existiam, {s.result.failed.length} falharam
              {s.result.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-danger-text">
                  {s.result.failed.map((f, i) => <li key={i}>• {f.clientName}: {f.errorMessage}</li>)}
                </ul>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
