import { useEffect, useState, useSyncExternalStore } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Button } from './button'

// The app's own confirm/prompt (instead of the browser's "localhost diz"): call askConfirm/askText
// from anywhere; <AppDialogs /> (mounted once in App) shows them with the app look.

interface Base { title: string; description?: string; confirmLabel?: string; danger?: boolean }
export type ConfirmOptions = Base
export interface TextOptions extends Base { label: string; placeholder?: string; optional?: boolean }

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; options: TextOptions; resolve: (v: string | null) => void }

let current: Pending | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

function open(next: Pending) {
  // A dialog left open is answered as "cancel" before the next one shows
  if (current?.kind === 'confirm') current.resolve(false)
  else if (current?.kind === 'text') current.resolve(null)
  current = next
  emit()
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', options, resolve }))
}

export function askText(options: TextOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'text', options, resolve }))
}

function close() {
  current = null
  emit()
}

export function AppDialogs() {
  const pending = useSyncExternalStore(subscribe, () => current, () => null)
  const [value, setValue] = useState('')
  useEffect(() => { setValue('') }, [pending])

  if (!pending) return null
  const { options } = pending
  const cancel = () => {
    if (pending.kind === 'confirm') pending.resolve(false)
    else pending.resolve(null)
    close()
  }
  const trimmed = value.trim()
  const canConfirm = pending.kind === 'confirm' || pending.options.optional || trimmed.length > 0
  const confirm = () => {
    if (!canConfirm) return
    if (pending.kind === 'confirm') pending.resolve(true)
    else pending.resolve(trimmed || null)
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>Cancelar</Button>
            <Button type="submit" variant={options.danger ? 'destructive' : 'default'} disabled={!canConfirm} autoFocus={pending.kind === 'confirm'}>
              {options.confirmLabel ?? 'Confirmar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
