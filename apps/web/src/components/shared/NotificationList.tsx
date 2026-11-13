import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { notificationsApi, timeAgo, TYPE_LABEL, UNREAD_KEY, LIST_KEY, type InAppNotification } from './notifications'

interface Props {
  items: InAppNotification[]
  onOpen?: (n: InAppNotification) => void
  // Page view shows the type and a "mark as unread/read" toggle; the dropdown stays compact
  detailed?: boolean
}

export function NotificationList({ items, onOpen, detailed = false }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: UNREAD_KEY }), qc.invalidateQueries({ queryKey: LIST_KEY })])

  const toggle = useMutation({
    mutationFn: (n: InAppNotification) => (n.readAt ? notificationsApi.unread(n.id) : notificationsApi.read(n.id)),
    onSettled: refresh,
  })

  async function open(n: InAppNotification) {
    // Clicking opens the place and marks it read; a failed mark never blocks the navigation
    if (!n.readAt) await notificationsApi.read(n.id).catch(() => undefined)
    void refresh()
    onOpen?.(n)
    navigate(n.link)
  }

  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma notificação por aqui.</p>
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((n) => (
        <li key={n.id} className={cn('flex items-start gap-2', !n.readAt && 'bg-info-bg/40')}>
          <button type="button" onClick={() => open(n)} className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-neutral-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <div className="flex items-start gap-2">
              <span aria-hidden className={cn('mt-1.5 h-2 w-2 rounded-full flex-shrink-0', n.readAt ? 'bg-transparent' : 'bg-accent')} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm text-foreground', !n.readAt && 'font-semibold')}>{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {detailed && <>{TYPE_LABEL[n.type]} · </>}
                  {timeAgo(n.createdAt)}
                </p>
              </div>
            </div>
          </button>
          {detailed && (
            <button
              type="button"
              onClick={() => toggle.mutate(n)}
              className="flex-shrink-0 m-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-neutral-bg hover:text-foreground"
            >
              {n.readAt ? 'Marcar como não lida' : 'Marcar como lida'}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
