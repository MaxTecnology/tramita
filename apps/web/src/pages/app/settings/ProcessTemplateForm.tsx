import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2, Plus, GripVertical, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import type { ProcessTemplate, OSModel, Department } from '@/types'
import { Toggle, fieldCls } from './formBlocks'

type StatusEffect = ProcessTemplate['columns'][number]['statusEffect']

const STATUS_EFFECT_LABEL: Record<StatusEffect, string> = {
  NONE: 'Fase (sem efeito no status)',
  OPEN: 'Aberto',
  STARTED: 'Iniciado',
  BLOCKED: 'Com Impedimento',
  DISREGARDED: 'Desconsiderado',
  DONE: 'Concluído',
}

interface ColumnFormState {
  title: string
  statusEffect: StatusEffect
  notifyClient: boolean
  documents: { name: string }[]
}

// OS the process creates when opened: model, column (index) where it is born, items it waits for
interface ItemFormState {
  osModelId: string
  columnIndex: number
  dependsOn: number[]
}

interface FormState {
  name: string
  description: string
  isActive: boolean
  departmentId: string
  deadlineBusinessDays: string
  clientCanRequest: boolean
  columns: ColumnFormState[]
  items: ItemFormState[]
}

function hasCycle(items: ItemFormState[]): boolean {
  const state = new Array<number>(items.length).fill(0)
  const visit = (i: number): boolean => {
    if (state[i] === 1) return true
    if (state[i] === 2) return false
    state[i] = 1
    const found = items[i].dependsOn.some((d) => d < items.length && visit(d))
    state[i] = 2
    return found
  }
  return items.some((_, i) => visit(i))
}

const EMPTY_COLUMN: ColumnFormState = { title: '', statusEffect: 'NONE', notifyClient: false, documents: [] }
const EMPTY_FORM: FormState = { name: '', description: '', isActive: true, departmentId: '', deadlineBusinessDays: '', clientCanRequest: false, columns: [{ ...EMPTY_COLUMN }], items: [] }

function DocumentListEditor({ items, onChange }: {
  items: { name: string }[]
  onChange: (items: { name: string }[]) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Documentos</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nome do documento"
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => { if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }}>
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

function ColumnEditor({ column, index, onChange, onRemove, canRemove }: {
  column: ColumnFormState
  index: number
  onChange: (column: ColumnFormState) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
      <div className="flex items-center gap-2">
        <GripVertical size={14} className="text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-semibold text-muted-foreground flex-shrink-0">Coluna {index + 1}</span>
        <Input
          value={column.title}
          onChange={(e) => onChange({ ...column, title: e.target.value })}
          placeholder="Título da coluna"
          className="h-8 text-sm flex-1"
          required
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground flex-shrink-0"
          aria-label="Remover coluna"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <select
            value={column.statusEffect}
            onChange={(e) => onChange({ ...column, statusEffect: e.target.value as StatusEffect })}
            className="h-8 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm"
          >
            {Object.entries(STATUS_EFFECT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground self-end pb-1.5">
          <input type="checkbox" checked={column.notifyClient} onChange={(e) => onChange({ ...column, notifyClient: e.target.checked })} />
          Notificar cliente
        </label>
      </div>

      <DocumentListEditor items={column.documents} onChange={(documents) => onChange({ ...column, documents })} />
    </div>
  )
}

export default function ProcessTemplateForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: template, isLoading } = useQuery<ProcessTemplate>({
    queryKey: ['process-template', id],
    queryFn: () => api.get(`/process-templates/${id}`).then((r) => r.data),
    enabled: isEditing,
  })

  const { data: departments = [] } = useQuery<Department[]>({ queryKey: ['departments'], queryFn: () => api.get('/departments').then((r) => r.data) })
  const { data: processModels = [] } = useQuery<OSModel[]>({
    queryKey: ['os-models', 'process'],
    queryFn: () => api.get('/os-models', { params: { usage: 'process' } }).then((r) => r.data),
  })

  useEffect(() => {
    if (!template) return
    setForm({
      name: template.name,
      description: template.description ?? '',
      isActive: template.isActive,
      departmentId: template.departmentId ?? '',
      deadlineBusinessDays: template.deadlineBusinessDays ? String(template.deadlineBusinessDays) : '',
      clientCanRequest: template.clientCanRequest,
      items: template.items.map((it) => ({ osModelId: it.osModelId, columnIndex: it.columnPosition, dependsOn: it.dependsOn })),
      columns: template.columns.map((c) => ({
        title: c.title,
        statusEffect: c.statusEffect,
        notifyClient: c.notifyClient,
        documents: c.documents.map((d) => ({ name: d.name })),
      })),
    })
  }, [template])

  const saveMutation = useMutation({
    mutationFn: () => {
      const base = {
        name: form.name, isActive: form.isActive, columns: form.columns,
        departmentId: form.departmentId || null,
        deadlineBusinessDays: form.deadlineBusinessDays ? Number(form.deadlineBusinessDays) : null,
        clientCanRequest: form.clientCanRequest,
        items: form.items,
      }
      // No PATCH (edição), descrição vazia precisa virar `null` pra realmente limpar no banco —
      // `undefined` faz o Prisma ignorar o campo. No POST (criação) não há nada a limpar.
      return isEditing
        ? api.patch(`/process-templates/${id}`, { ...base, description: form.description || null }).then((r) => r.data)
        : api.post('/process-templates', { ...base, description: form.description || undefined }).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Modelo atualizado' : 'Modelo criado')
      qc.invalidateQueries({ queryKey: ['process-templates'] })
      navigate('/app/settings/process-templates')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar modelo')
    },
  })

  function updateColumn(index: number, column: ColumnFormState) {
    setForm((f) => ({ ...f, columns: f.columns.map((c, i) => (i === index ? column : c)) }))
  }

  function addColumn() {
    setForm((f) => ({ ...f, columns: [...f.columns, { ...EMPTY_COLUMN }] }))
  }

  function removeColumn(index: number) {
    // Items born in a removed column move to the first one; later columns shift down
    setForm((f) => ({
      ...f,
      columns: f.columns.filter((_, i) => i !== index),
      items: f.items.map((it) => ({ ...it, columnIndex: it.columnIndex === index ? 0 : it.columnIndex > index ? it.columnIndex - 1 : it.columnIndex })),
    }))
  }

  function updateItem(index: number, item: ItemFormState) {
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? item : it)) }))
  }

  function removeItem(index: number) {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== index).map((it) => ({ ...it, dependsOn: it.dependsOn.filter((d) => d !== index).map((d) => (d > index ? d - 1 : d)) })),
    }))
  }

  const modelName = (osModelId: string) => processModels.find((m) => m.id === osModelId)?.name ?? 'OS'
  const cycle = hasCycle(form.items)
  const needsDepartment = form.clientCanRequest && !form.departmentId
  const canSave = form.name.trim().length > 0 && form.columns.length > 0 && form.columns.every((c) => c.title.trim().length > 0)
    && form.items.every((it) => !!it.osModelId) && !cycle && !needsDepartment

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/app/settings/process-templates" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">
          {isEditing ? 'Editar modelo de processo' : 'Novo modelo de processo'}
        </h1>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="pt-name">Nome</Label>
          <Input id="pt-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Abertura de empresa" required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pt-description">Descrição</Label>
          <Input id="pt-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pt-department">Departamento que avalia os pedidos</Label>
            <select id="pt-department" className={fieldCls} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">Nenhum</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-deadline">Prazo do processo (dias úteis)</Label>
            <Input id="pt-deadline" inputMode="numeric" value={form.deadlineBusinessDays} placeholder="Vazio = sem prazo"
              onChange={(e) => setForm({ ...form, deadlineBusinessDays: e.target.value.replace(/\D/g, '') })} />
          </div>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border px-3">
          <Toggle checked={form.clientCanRequest} onChange={(v) => setForm({ ...form, clientCanRequest: v })}
            label="Cliente pode solicitar" hint="Aparece na lista de serviços do portal; a aprovação abre o processo." />
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Ativo" hint="Inativo não aparece para abrir novos processos." />
        </div>
        {needsDepartment && <p className="text-xs text-danger-text">Escolha o departamento que avalia os pedidos deste processo</p>}

        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <Label>Colunas</Label>
            <Button type="button" variant="outline" size="sm" onClick={addColumn} className="gap-1.5">
              <Plus size={14} />
              Adicionar coluna
            </Button>
          </div>

          <div className="space-y-3">
            {form.columns.map((column, i) => (
              <ColumnEditor
                key={i}
                column={column}
                index={i}
                onChange={(c) => updateColumn(i, c)}
                onRemove={() => removeColumn(i)}
                canRemove={form.columns.length > 1}
              />
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="flex items-center gap-1.5"><ListChecks size={14} />OS do processo</Label>
              <p className="text-xs text-muted-foreground">Nascem ao abrir o processo; uma OS que depende de outra só começa quando a outra termina.</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 whitespace-nowrap flex-shrink-0"
              onClick={() => setForm((f) => ({ ...f, items: [...f.items, { osModelId: '', columnIndex: 0, dependsOn: [] }] }))}>
              <Plus size={14} />Adicionar OS
            </Button>
          </div>
          {form.items.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OS: o processo nasce só com as colunas.</p>}
          {form.items.map((item, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-3 space-y-2">
              <div className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_11rem_auto] items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">OS {i + 1}</span>
                <select aria-label={`Modelo da OS ${i + 1}`} className={fieldCls} value={item.osModelId}
                  onChange={(e) => updateItem(i, { ...item, osModelId: e.target.value })}>
                  <option value="">Escolha o modelo...</option>
                  {processModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select aria-label={`Coluna da OS ${i + 1}`} className={`${fieldCls} col-span-2 sm:col-span-1 order-last sm:order-none`} value={item.columnIndex}
                  onChange={(e) => updateItem(i, { ...item, columnIndex: Number(e.target.value) })}>
                  {form.columns.map((c, ci) => <option key={ci} value={ci}>{c.title || `Coluna ${ci + 1}`}</option>)}
                </select>
                <button type="button" aria-label={`Remover OS ${i + 1}`} onClick={() => removeItem(i)} className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text">
                  <Trash2 size={14} />
                </button>
              </div>
              {form.items.length > 1 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Espera:</span>
                  {form.items.map((other, j) => j !== i && (
                    <label key={j} className="inline-flex items-center gap-1 text-foreground">
                      <input type="checkbox" aria-label={`OS ${i + 1} depende da OS ${j + 1}`} checked={item.dependsOn.includes(j)}
                        onChange={(e) => updateItem(i, { ...item, dependsOn: e.target.checked ? [...item.dependsOn, j].sort((a, b) => a - b) : item.dependsOn.filter((d) => d !== j) })} />
                      OS {j + 1}{other.osModelId ? ` · ${modelName(other.osModelId)}` : ''}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          {cycle && <p className="text-xs text-danger-text">Dependência circular</p>}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/process-templates')}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending || !canSave}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
