import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { ChoiceGroup } from '@/components/ui/choice-group'
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
    <ChoiceGroup
      label="Tema"
      variant="quiet"
      className={className}
      value={pref}
      onChange={(v) => { setThemePreference(v); setPref(v) }}
      options={OPTIONS.map(({ value, label, icon: Icon }) => ({ value, label, iconOnly: true, icon: <Icon size={14} aria-hidden /> }))}
    />
  )
}
