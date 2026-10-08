import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringTaskTemplate, Department } from '@/types'
import { PRIORITY_LABEL } from '@/components/shared/TaskDrawer'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  ANNUAL: 'Anual',
}

const GENERATION_MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
const COMPETENCE_MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
const WEEKDAY_LABEL: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' }

const QUARTERLY_ANCHOR_OPTIONS = [
  { value: 1, label: 'Jan, Abr, Jul, Out' },
  { value: 2, label: 'Fev, Mai, Ago, Nov' },
  { value: 3, label: 'Mar, Jun, Set, Dez' },
]
const MONTH_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const BUSINESS_DAY_ROLL_LABEL: Record<RecurringTaskTemplate['dueBusinessDayRoll'], string> = {
  NONE: 'Não ajustar',
  FORWARD: 'Empurrar pro próximo dia útil',
  BACKWARD: 'Antecipar pro dia útil anterior',
}

function isWeekendUTC(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

function rollToBusinessDayUTC(d: Date, direction: RecurringTaskTemplate['dueBusinessDayRoll']): Date {
  if (direction === 'NONE') return d
  const step = direction === 'FORWARD' ? 1 : -1
  const result = new Date(d)
  while (isWeekendUTC(result)) result.setUTCDate(result.getUTCDate() + step)
  return result
}

function clampDayOfMonthUTC(year: number, monthIndex: number, day: number): number {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, daysInMonth)
}

/**
 * Preview "se gerasse hoje" — mesma cadeia de cálculo do backend (recurrence-dates.ts), espelhada
 * no cliente pra dar feedback imediato enquanto o usuário ajusta a config, sem round-trip à API.
 * WEEKLY fica fora (não participa do redesenho vencimento-como-âncora, ver spec).
 */
function computePreview(form: FormState): { dueDate: Date; competence: Date } | null {
  if (form.periodicity === 'WEEKLY') return null

  const today = new Date()
  let candidate = new Date(Date.UTC(today.getFullYear(), today.getMonth() + form.generationMonthOffset, 1))

  if (form.periodicity !== 'MONTHLY') {
    const matchesAnchor = (d: Date): boolean =>
      form.periodicity === 'QUARTERLY'
        ? d.getUTCMonth() % 3 === (form.dueMonthAnchor - 1) % 3
        : d.getUTCMonth() === form.dueMonthAnchor - 1
    while (!matchesAnchor(candidate)) {
      candidate = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 1))
    }
  }

  const dueDay = clampDayOfMonthUTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), form.dueDayOfPeriod)
  const dueDateRaw = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), dueDay))
  const dueDate = rollToBusinessDayUTC(dueDateRaw, form.dueBusinessDayRoll)
  const competence = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() - form.competenceMonthOffset, 1))

  return { dueDate, competence }
}

interface FormState {
  departmentId: string
  title: string
  description: string
  periodicity: RecurringTaskTemplate['periodicity']
  priority: RecurringTaskTemplate['priority']
  dueDayOfPeriod: number
  dueBusinessDayRoll: RecurringTaskTemplate['dueBusinessDayRoll']
  dueMonthAnchor: number
  competenceMonthOffset: number
  targetOffsetDays: number
  targetBusinessDayRoll: RecurringTaskTemplate['targetBusinessDayRoll']
  generationMonthOffset: number
  generationDayOfPeriod: number
  autoCompleteOnAllActivitiesDone: boolean
  notifyViaWhatsapp: boolean
  notifyViaEmail: boolean
  visibleToClient: boolean
  isActive: boolean
  documentRequests: { name: string }[]
  documentDeliveries: { name: string }[]
}

const EMPTY_FORM: FormState = {
  departmentId: '', title: '', description: '', periodicity: 'MONTHLY', priority: 'MEDIUM',
  dueDayOfPeriod: 10, dueBusinessDayRoll: 'NONE', dueMonthAnchor: 1, competenceMonthOffset: 1,
  targetOffsetDays: 0, targetBusinessDayRoll: 'NONE',
  generationMonthOffset: 1, generationDayOfPeriod: 20,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
}

function DocumentListEditor({ label, items, onChange }: {
  label: string
  items: { name: string }[]
  onChange: (items: { name: string }[]) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nome do documento"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }
          }}
        />
        <Button type="button" variant="outline" onClick={() => { if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }}>
          Adicionar
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1">
              {item.name}
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger-text">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RecurringTemplateForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: template, isLoading } = useQuery<RecurringTaskTemplate>({
    queryKey: ['recurring-template', id],
    queryFn: () => api.get(`/recurring-templates/${id}`).then((r) => r.data),
    enabled: isEditing,
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  useEffect(() => {
    if (!template) return
    setForm({
      departmentId: template.departmentId, title: template.title, description: template.description ?? '',
      periodicity: template.periodicity, priority: template.priority, dueDayOfPeriod: template.dueDayOfPeriod,
      dueBusinessDayRoll: template.dueBusinessDayRoll, dueMonthAnchor: template.dueMonthAnchor, competenceMonthOffset: template.competenceMonthOffset, targetOffsetDays: template.targetOffsetDays,
      targetBusinessDayRoll: template.targetBusinessDayRoll, generationMonthOffset: template.generationMonthOffset,
      generationDayOfPeriod: template.generationDayOfPeriod, autoCompleteOnAllActivitiesDone: template.autoCompleteOnAllActivitiesDone,
      notifyViaWhatsapp: template.notifyViaWhatsapp, notifyViaEmail: template.notifyViaEmail, visibleToClient: template.visibleToClient,
      isActive: template.isActive,
      documentRequests: template.documentRequests.map((d) => ({ name: d.name })),
      documentDeliveries: template.documentDeliveries.map((d) => ({ name: d.name })),
    })
  }, [template])

  const saveMutation = useMutation({
    mutationFn: () =>
      isEditing
        ? api.patch(`/recurring-templates/${id}`, form).then((r) => r.data)
        : api.post('/recurring-templates', form).then((r) => r.data),
    onSuccess: () => {
      toast.success(isEditing ? 'Template atualizado' : 'Template criado')
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
      navigate('/app/settings/recurring-templates')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar template')
    },
  })

  const isWeekly = form.periodicity === 'WEEKLY'
  const isQuarterlyOrAnnual = form.periodicity === 'QUARTERLY' || form.periodicity === 'ANNUAL'
  const dayOptions = isWeekly ? [1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 31 }, (_, i) => i + 1)
  const preview = computePreview(form)

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/app/settings/recurring-templates" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">
          {isEditing ? 'Editar template' : 'Novo template'}
        </h1>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label>Título</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Folha de pagamento" required />
        </div>

        <div className="space-y-1.5">
          <Label>Departamento</Label>
          <select
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            required
          >
            <option value="">Selecione</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Periodicidade</Label>
          <select
            value={form.periodicity}
            onChange={(e) => setForm({ ...form, periodicity: e.target.value as FormState['periodicity'] })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          >
            {Object.entries(PERIODICITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Prioridade</Label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as FormState['priority'] })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          >
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className={isQuarterlyOrAnnual ? 'grid grid-cols-2 gap-3' : 'space-y-1.5'}>
          <div className="space-y-1.5">
            <Label>{isWeekly ? 'Dia da semana do vencimento' : 'Dia do vencimento'}</Label>
            <select
              value={form.dueDayOfPeriod}
              onChange={(e) => setForm({ ...form, dueDayOfPeriod: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            >
              {dayOptions.map((d) => <option key={d} value={d}>{isWeekly ? WEEKDAY_LABEL[d] : d}</option>)}
            </select>
          </div>
          {form.periodicity === 'QUARTERLY' && (
            <div className="space-y-1.5">
              <Label>Mês</Label>
              <select
                value={form.dueMonthAnchor}
                onChange={(e) => setForm({ ...form, dueMonthAnchor: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
              >
                {QUARTERLY_ANCHOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          {form.periodicity === 'ANNUAL' && (
            <div className="space-y-1.5">
              <Label>Mês</Label>
              <select
                value={form.dueMonthAnchor}
                onChange={(e) => setForm({ ...form, dueMonthAnchor: Number(e.target.value) })}
                className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
              >
                {MONTH_LABEL.map((label, i) => <option key={i} value={i + 1}>{label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Se o vencimento cair em fim de semana</Label>
          <select
            value={form.dueBusinessDayRoll}
            onChange={(e) => setForm({ ...form, dueBusinessDayRoll: e.target.value as FormState['dueBusinessDayRoll'] })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          >
            {(['NONE', 'FORWARD', 'BACKWARD'] as const).map((v) => <option key={v} value={v}>{BUSINESS_DAY_ROLL_LABEL[v]}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Competência — meses antes do vencimento</Label>
          <select
            value={form.competenceMonthOffset}
            onChange={(e) => setForm({ ...form, competenceMonthOffset: Number(e.target.value) })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            disabled={isWeekly}
          >
            {COMPETENCE_MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês do vencimento' : `${o} ${o === 1 ? 'mês' : 'meses'} antes do vencimento`}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Meta interna — dias em relação ao vencimento (negativo = antes)</Label>
          <Input
            type="number"
            value={form.targetOffsetDays}
            onChange={(e) => setForm({ ...form, targetOffsetDays: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Se a meta cair em fim de semana</Label>
          <select
            value={form.targetBusinessDayRoll}
            onChange={(e) => setForm({ ...form, targetBusinessDayRoll: e.target.value as FormState['targetBusinessDayRoll'] })}
            className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          >
            {(['NONE', 'FORWARD', 'BACKWARD'] as const).map((v) => <option key={v} value={v}>{BUSINESS_DAY_ROLL_LABEL[v]}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Geração — meses antes do vencimento</Label>
            <select
              value={form.generationMonthOffset}
              onChange={(e) => setForm({ ...form, generationMonthOffset: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            >
              {GENERATION_MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês' : `${o} ${o === 1 ? 'mês' : 'meses'} antes`}</option>)}
            </select>
            {form.generationMonthOffset === 0 && (
              <p className="text-xs text-danger-text mt-1">
                ⚠ Com 0 mês de antecedência, a tarefa é gerada no mesmo mês do vencimento — se o dia do vencimento já tiver passado quando o cron disparar, ela nasce vencida.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Dia da geração</Label>
            <select
              value={form.generationDayOfPeriod}
              onChange={(e) => setForm({ ...form, generationDayOfPeriod: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {preview && (
          <div className="rounded-md border border-border bg-neutral-bg px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Preview — se gerasse hoje:</span>{' '}
            vence em {preview.dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}, competência{' '}
            {preview.competence.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          </div>
        )}

        <DocumentListEditor
          label="Documentos a cobrar do cliente"
          items={form.documentRequests}
          onChange={(items) => setForm({ ...form, documentRequests: items })}
        />
        <DocumentListEditor
          label="Documentos a entregar ao cliente"
          items={form.documentDeliveries}
          onChange={(items) => setForm({ ...form, documentDeliveries: items })}
        />

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.autoCompleteOnAllActivitiesDone} onChange={(e) => setForm({ ...form, autoCompleteOnAllActivitiesDone: e.target.checked })} />
          Concluir automaticamente quando todas as atividades forem resolvidas
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.notifyViaWhatsapp} onChange={(e) => setForm({ ...form, notifyViaWhatsapp: e.target.checked })} />
            Notificar via WhatsApp
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.notifyViaEmail} onChange={(e) => setForm({ ...form, notifyViaEmail: e.target.checked })} />
            Notificar via e-mail
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.visibleToClient} onChange={(e) => setForm({ ...form, visibleToClient: e.target.checked })} />
          O cliente pode ver esta tarefa
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Ativo
        </label>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/recurring-templates')}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending || !form.title.trim() || !form.departmentId}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
