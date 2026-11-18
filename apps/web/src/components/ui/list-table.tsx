import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface ListColumn<T> {
  header: string
  // CSS grid track for the desktop table (e.g. 'minmax(0,2fr)')
  width: string
  cell: (row: T) => ReactNode
}

// The settings list: a table on wide screens; on phones each row is a card where every column
// after the first shows its header as a label. The actions sit at the end of the row.
export function ListTable<T>({ label, columns, rows, rowKey, actions, empty, loading, muted }: {
  label: string
  columns: ListColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  actions?: (row: T) => ReactNode
  empty: ReactNode
  loading?: boolean
  // Rows shown dimmed (e.g. inactive)
  muted?: (row: T) => boolean
}) {
  const template = [...columns.map((c) => c.width), actions ? 'auto' : ''].filter(Boolean).join(' ')
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div role="row" className="hidden md:grid gap-4 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => <span key={c.header} role="columnheader">{c.header}</span>)}
        {actions && <span aria-hidden />}
      </div>
      {loading ? (
        <div aria-label={`Carregando ${label.toLowerCase()}`} className="divide-y divide-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 px-4 py-4">
              <div className="h-3 w-48 rounded bg-neutral-bg motion-safe:animate-pulse" />
              <div className="h-3 w-72 rounded bg-neutral-bg motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-12 text-center">{empty}</div>
      ) : (
        <ul aria-label={label} className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={rowKey(row)}
              data-list-row
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-3.5 md:items-center md:gap-4 md:[grid-template-columns:var(--cols)]',
                muted?.(row) && 'opacity-60',
              )}
              style={{ ['--cols' as string]: template }}
            >
              {columns.map((c, i) => (
                <div key={c.header} className={cn('min-w-0', i > 0 && 'col-start-1 md:col-start-auto')}>
                  {i > 0 && <span className="mr-1.5 text-xs text-muted-foreground md:hidden">{c.header}:</span>}
                  {c.cell(row)}
                </div>
              ))}
              {actions && (
                <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-start-auto">
                  {actions(row)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// "Editar" of a row: a named link (the person reads what it does), with the item in its label
export function EditLink({ to, name }: { to: string; name: string }) {
  return (
    <Link
      to={to}
      aria-label={`Editar ${name}`}
      className="rounded-md px-2.5 py-1.5 text-sm text-foreground hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Editar
    </Link>
  )
}

export function StatusTag({ children }: { children: ReactNode }) {
  return <span className="rounded bg-neutral-bg px-1.5 py-0.5 text-xs text-muted-foreground">{children}</span>
}
