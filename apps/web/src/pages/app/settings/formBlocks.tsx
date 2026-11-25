import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, FileText, DollarSign, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ObligationType } from '@/types'
import { ChoiceGroup } from '@/components/ui/choice-group'

// Building blocks shared by the template forms (recurring task, OS model, process model)

export const fieldCls = 'h-9 w-full rounded-md border border-border bg-surface text-foreground px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'


export function Section({ step, icon, title, hint, children }: { step: number; icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 md:p-5 space-y-4">
      <header className="flex items-start gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-bg text-accent">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{step}. {title}</h2>
          {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// Buttons in a row instead of a select: every choice is visible at a glance
export function Segmented<T extends string | number>({ label, value, options, onChange, disabled }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return <ChoiceGroup label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[1.125rem]' : 'left-0.5')} />
      </button>
    </label>
  )
}

export type DocumentListItem = { name: string; requiresPayment?: boolean; obligationTypeId?: string }

// Delivery rows get the "guia" marker (tracked as paid/unpaid in the client portal)
export function DocumentList({ title, icon, placeholder, items, onChange, withPaymentToggle = false, robotOptions }: {
  title: string
  icon: ReactNode
  placeholder: string
  items: DocumentListItem[]
  onChange: (items: DocumentListItem[]) => void
  withPaymentToggle?: boolean
  // Delivery rows: which obligation the robot recognizes for this document (none = manual only)
  robotOptions?: ObligationType[]
}) {
  const [draft, setDraft] = useState('')
  const add = () => { if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }
  return (
    <div className="rounded-lg border border-border bg-neutral-bg/40 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">{icon}{title}</p>
      <div className="flex gap-2">
        <Input
          aria-label={title}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <Button type="button" variant="outline" onClick={add} aria-label={`Adicionar em ${title}`}><Plus size={14} /></Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum documento.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm">
              <FileText size={13} className="flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-foreground">{item.name}</span>
              {robotOptions && (
                <select
                  aria-label={`Robô de ${item.name}`}
                  title="Robô de leitura: quando ler este tipo de documento, sugere esta entrega"
                  value={item.obligationTypeId ?? ''}
                  onChange={(e) => onChange(items.map((it, idx) => (idx === i ? { ...it, obligationTypeId: e.target.value || undefined } : it)))}
                  className={cn(
                    'h-6 max-w-[7.5rem] rounded-full border px-1.5 text-[11px] font-medium bg-surface',
                    item.obligationTypeId ? 'border-info-text/40 text-info-text' : 'border-border text-muted-foreground',
                  )}
                >
                  <option value="">🤖 sem robô</option>
                  {robotOptions.map((o) => <option key={o.id} value={o.id}>🤖 {o.name}</option>)}
                </select>
              )}
              {withPaymentToggle && (
                <button
                  type="button"
                  onClick={() => onChange(items.map((it, idx) => (idx === i ? { ...it, requiresPayment: !it.requiresPayment } : it)))}
                  aria-pressed={!!item.requiresPayment}
                  title="Guia de pagamento: o cliente marca como paga no portal"
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    item.requiresPayment ? 'bg-success-bg text-success-text' : 'border border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <DollarSign size={11} />guia
                </button>
              )}
              <button type="button" aria-label={`Remover ${item.name}`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger-text">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
