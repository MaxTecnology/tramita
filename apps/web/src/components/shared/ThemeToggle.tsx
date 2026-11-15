import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Automático', icon: Monitor },
]

// Claro · Escuro · Automático (follows the operating system). Saved in this browser.
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference)
  return (
    <div role="radiogroup" aria-label="Tema" className={cn('flex rounded-md border border-border bg-surface p-0.5', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => { setThemePreference(value); setPref(value) }}
          className={cn(
            'flex flex-1 items-center justify-center rounded py-1.5 transition-colors',
            pref === value ? 'bg-neutral-bg text-accent' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
