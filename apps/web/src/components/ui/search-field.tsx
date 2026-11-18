import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

// Search box of the lists: the label is for screen readers, the placeholder says what it searches
export function SearchField({ label, value, onChange, placeholder, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </div>
  )
}
