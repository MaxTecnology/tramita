import { useEffect, useState, useSyncExternalStore } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Button } from './button'

// The app's own confirm/prompt (instead of the browser's "localhost diz"): call askConfirm/askText
// from anywhere; <AppDialogs /> (mounted once in App) shows them with the app look.

interface Base { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export type ConfirmOptions = Base
export interface TextOptions extends Base { label: string; placeholder?: string; optional?: boolean }
// Pick one option, with a note (required by some options) — e.g. the reason of a delay
export interface ChoiceOptions extends Base {
  label: string
  choices: { value: string; label: string; requiresNote?: boolean }[]
  noteLabel?: string
}
export interface ChoiceAnswer { value: string; note?: string }

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; options: TextOptions; resolve: (v: string | null) => void }
  | { kind: 'choice'; options: ChoiceOptions; resolve: (v: ChoiceAnswer | null) => void }

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

function open(next: Pending) {
  // A dialog left open is answered as "cancel" before the next one shows
  if (current?.kind === 'confirm') current.resolve(false)
  else if (current) current.resolve(null)
  current = next
  emit()
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', options, resolve }))
}

export function askText(options: TextOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'text', options, resolve }))
}

export function askChoice(options: ChoiceOptions): Promise<ChoiceAnswer | null> {
  return new Promise((resolve) => open({ kind: 'choice', options, resolve }))
}

function close() {
  current = null
  emit()
}

export function AppDialogs() {
  const pending = useSyncExternalStore(subscribe, () => current, () => null)
  const [value, setValue] = useState('')
  const [choice, setChoice] = useState('')
  useEffect(() => { setValue(''); setChoice('') }, [pending])

  if (!pending) return null
  const { options } = pending
  const cancel = () => {
    if (pending.kind === 'confirm') pending.resolve(false)
    else pending.resolve(null)
    close()
  }
  const trimmed = value.trim()
  const picked = pending.kind === 'choice' ? pending.options.choices.find((c) => c.value === choice) : undefined
  const canConfirm = pending.kind === 'confirm'
    || (pending.kind === 'text' && (pending.options.optional || trimmed.length > 0))
    || (pending.kind === 'choice' && !!picked && (!picked.requiresNote || trimmed.length > 0))
  const confirm = () => {
    if (!canConfirm) return
    if (pending.kind === 'confirm') pending.resolve(true)
    else if (pending.kind === 'text') pending.resolve(trimmed || null)
    else pending.resolve({ value: choice, ...(trimmed ? { note: trimmed } : {}) })
    close()
  }

  return (
    <Dialog open onOpenChange={(isOpen) => { if (!isOpen) cancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{options.title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); confirm() }} className="space-y-4">
          {options.description && <p className="text-sm text-muted-foreground">{options.description}</p>}
          {pending.kind === 'text' && (
            <label className="block text-sm text-foreground">
              {pending.options.label}
              <textarea
                autoFocus
                aria-label={pending.options.label}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm() } }}
                placeholder={pending.options.placeholder}
                rows={3}
                className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
              />
            </label>
          )}
          {pending.kind === 'choice' && (
            <div className="space-y-3">
              <label className="block text-sm text-foreground">
                {pending.options.label}
                <select
                  autoFocus
                  aria-label={pending.options.label}
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="">Selecione...</option>
                  {pending.options.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-sm text-foreground">
                {pending.options.noteLabel ?? 'Observação'}{picked?.requiresNote ? '' : ' (opcional)'}
                <textarea
                  aria-label={pending.options.noteLabel ?? 'Observação'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
                />
              </label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>{options.cancelLabel ?? 'Cancelar'}</Button>
            <Button type="submit" variant={options.danger ? 'destructive' : 'default'} disabled={!canConfirm} autoFocus={pending.kind === 'confirm'}>
              {options.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
