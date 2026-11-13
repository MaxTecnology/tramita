import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationList } from './NotificationList'
import { notificationsApi, UNREAD_KEY, LIST_KEY, type InAppNotification } from './notifications'

interface Props {
  base: '/app' | '/portal'
  onOpen?: (n: InAppNotification) => void
  // Where the panel opens relative to the bell
  align?: 'left' | 'right'
  className?: string
}

export function NotificationBell({ base, onOpen, align = 'left', className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  // Refreshed on returning to the tab and every 60 s (real time via SSE is a later step)
  const { data: unread } = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: notificationsApi.unreadCount,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  })
  const { data: latest } = useQuery({
    queryKey: [...LIST_KEY, 'latest'],
    queryFn: () => notificationsApi.list({ limit: 10 }),
    enabled: open,
  })
  const readAll = useMutation({
    mutationFn: notificationsApi.readAll,
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: UNREAD_KEY }), qc.invalidateQueries({ queryKey: LIST_KEY })]),
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const count = unread?.count ?? 0

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={count > 0 ? `Notificações (${count} não lidas)` : 'Notificações'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-danger-text text-danger-foreground text-[10px] font-semibold flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notificações"
          className={cn(
            'absolute z-[60] mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-surface shadow-lg',
            align === 'left' ? 'left-0' : 'right-0',
          )}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Notificações</p>
            <button
              type="button"
              disabled={count === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
              className="text-xs text-accent hover:underline disabled:opacity-50 disabled:no-underline"
            >
              Marcar todas como lidas
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {latest ? (
              <NotificationList items={latest.items} onOpen={(n) => { setOpen(false); onOpen?.(n) }} />
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</p>
            )}
          </div>
          <Link
            to={`${base}/notifications`}
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-sm text-accent hover:bg-neutral-bg rounded-b-lg"
          >
            Ver todas
          </Link>
        </div>
      )}
    </div>
  )
}
