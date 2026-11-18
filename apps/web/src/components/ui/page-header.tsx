import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Top of a page: way back, title, one line on what the page is for and its main action.
// `back.narrowOnly`: the link is only needed where no side menu is shown (settings on phones).
export function PageHeader({ title, description, back, actions }: {
  title: string
  description?: ReactNode
  back?: { to: string; label: string; narrowOnly?: boolean }
  actions?: ReactNode
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link
          to={back.to}
          className={cn('mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground', back.narrowOnly && 'lg:hidden')}
        >
          <ArrowLeft size={12} aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-bold text-foreground">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export const SETTINGS_BACK = { to: '/app/settings', label: 'Configurações', narrowOnly: true }
