import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Trash2, Plus, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { OSTemplate } from '@/types'

type StatusEffect = OSTemplate['columns'][number]['statusEffect']

const STATUS_EFFECT_LABEL: Record<StatusEffect, string> = {
  NONE: 'Fase (sem efeito no status)',
  OPEN: 'Aberto',
  STARTED: 'Iniciado',
  BLOCKED: 'Bloqueado',
  DISREGARDED: 'Desconsiderado',
  DONE: 'Concluído',
}

interface ColumnFormState {
  title: string
  statusEffect: StatusEffect
  notifyClient: boolean
  documents: { name: string }[]
}

interface FormState {
  name: string
  description: string
  isActive: boolean
  columns: ColumnFormState[]
}

const EMPTY_COLUMN: ColumnFormState = { title: '', statusEffect: 'NONE', notifyClient: false, documents: [] }
const EMPTY_FORM: FormState = { name: '', description: '', isActive: true, columns: [{ ...EMPTY_COLUMN }] }

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

export default function OSTemplateForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = !!id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: template, isLoading } = useQuery<OSTemplate>({
    queryKey: ['os-template', id],
    queryFn: () => api.get(`/os-templates/${id}`).then((r) => r.data),
    enabled: isEditing,
  })

  useEffect(() => {
    if (!template) return
    setForm({
      name: template.name,
      description: template.description ?? '',
      isActive: template.isActive,
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
      const payload = { name: form.name, description: form.description || undefined, isActive: form.isActive, columns: form.columns }
      return isEditing
        ? api.patch(`/os-templates/${id}`, payload).then((r) => r.data)
        : api.post('/os-templates', payload).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Template atualizado' : 'Template criado')
      qc.invalidateQueries({ queryKey: ['os-templates'] })
      navigate('/app/settings/os-templates')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar template')
    },
  })

  function updateColumn(index: number, column: ColumnFormState) {
    setForm((f) => ({ ...f, columns: f.columns.map((c, i) => (i === index ? column : c)) }))
  }

  function addColumn() {
    setForm((f) => ({ ...f, columns: [...f.columns, { ...EMPTY_COLUMN }] }))
  }

  function removeColumn(index: number) {
    setForm((f) => ({ ...f, columns: f.columns.filter((_, i) => i !== index) }))
  }

  const canSave = form.name.trim().length > 0 && form.columns.length > 0 && form.columns.every((c) => c.title.trim().length > 0)

  if (isEditing && isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/app/settings/os-templates" aria-label="Voltar" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg md:text-xl font-bold text-foreground">
          {isEditing ? 'Editar template' : 'Novo template'}
        </h1>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate() }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Abertura de empresa" required />
        </div>

        <div className="space-y-1.5">
          <Label>Descrição</Label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Opcional" />
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          Ativo
        </label>

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

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button type="button" variant="outline" onClick={() => navigate('/app/settings/os-templates')}>Cancelar</Button>
          <Button type="submit" disabled={saveMutation.isPending || !canSave}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
