import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ChoiceOption<T> {
  value: T
  label: string
  icon?: ReactNode
  // Only the icon shows: the label is said to screen readers and in the tooltip
  iconOnly?: boolean
}

// One choice among a few (situation, period, theme): a radio group with one tab stop. The arrows
// move and choose, Home/End jump to the ends — the ARIA radio group pattern.
export function ChoiceGroup<T extends string | number>({ label, value, options, onChange, variant = 'segmented', disabled, className }: {
  label: string
  value: T
  options: ChoiceOption<T>[]
  onChange: (v: T) => void
  // 'chips': rounded tags (filters over a list); 'segmented': joined buttons; 'quiet': joined,
  // full width, the chosen one only tinted (the theme switch in the menu)
  variant?: 'chips' | 'segmented' | 'quiet'
  disabled?: boolean
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(0, options.findIndex((o) => o.value === value))

  function move(to: number) {
    const i = (to + options.length) % options.length
    onChange(options[i].value)
    refs.current[i]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        variant === 'chips' ? 'flex flex-wrap gap-1.5'
          : variant === 'quiet' ? 'flex rounded-md border border-border bg-surface p-0.5'
          : 'inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = i === current
        return (
          <button
            key={String(o.value)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.iconOnly ? o.label : undefined}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1
                : e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : null
              if (to === null) return
              e.preventDefault()
              move(to)
            }}
            className={cn(
              'flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              variant === 'chips'
                ? cn('rounded-full border px-3 py-1 text-xs', checked ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground')
                : variant === 'quiet'
                  ? cn('flex-1 rounded py-1.5', checked ? 'bg-neutral-bg text-accent' : 'text-muted-foreground hover:text-foreground')
                  : cn('rounded px-3 py-1.5 text-sm', checked ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-neutral-bg hover:text-foreground'),
            )}
          >
            {o.icon}
            {!o.iconOnly && o.label}
          </button>
        )
      })}
    </div>
  )
}
