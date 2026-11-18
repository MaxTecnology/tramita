import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActionMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  // A line above this item (separates a destructive action from the rest)
  separated?: boolean
}

// "⋯" button with the less frequent actions of a row. Escape, Tab or a click outside closes it;
// arrows, Home and End move between the items; choosing one gives the focus back to the button.
export function ActionMenu({ label, items, icon }: { label: string; items: ActionMenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const onPointer = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    // Tab moves on: the menu does not stay open behind
    if (e.key === 'Tab') { setOpen(false); return }
    const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (options.length === 0) return
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    const target = {
      ArrowDown: (at + 1) % options.length,
      ArrowUp: (at - 1 + options.length) % options.length,
      Home: 0,
      End: options.length - 1,
    }[e.key]
    if (target === undefined) return
    e.preventDefault()
    options[target]?.focus()
  }

  if (items.length === 0) return null
  return (
    <div ref={wrapper} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {icon ?? <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-1 min-w-56 whitespace-nowrap rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <div key={`${i}-${item.label}`}>
              {item.separated && <div role="separator" className="my-1 border-t border-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { close(); item.onSelect() }}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:bg-neutral-bg hover:bg-neutral-bg disabled:opacity-50',
                  item.danger ? 'text-danger-text' : 'text-foreground',
                )}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
