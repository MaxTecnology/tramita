import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useEventStream } from './useEventStream'
import { UNREAD_KEY, LIST_KEY } from '@/components/shared/notifications'
import { alertNewNotification, type NewNotice } from '@/lib/inbox-alert'

const REFRESH_KEYS = [UNREAD_KEY, LIST_KEY, ['comments'], ['request-comments'], ['portal-requests-month'], ['portal-home'], ['task-approvals']]

function parseNotice(data: string): NewNotice | null {
  try {
    const n: unknown = JSON.parse(data)
    if (n && typeof n === 'object' && 'id' in n && 'title' in n && 'link' in n) {
      const { id, title, body, link } = n as Record<string, unknown>
      return { id: String(id), title: String(title), body: typeof body === 'string' ? body : '', link: String(link) }
    }
  } catch { /* malformed event: refresh only */ }
  return null
}

// Bell in real time: the person's own channel. A new notice rings (sound, toast or browser
// notification) and refreshes open conversations and the portal counters; a read only refreshes.
export function useInboxStream(enabled = true): void {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = () => { for (const queryKey of REFRESH_KEYS) queryClient.invalidateQueries({ queryKey }) }
  useEventStream('/notifications/stream', {
    'inbox:changed': refresh,
    'inbox:new': (data) => {
      refresh()
      const notice = parseNotice(data)
      if (notice) alertNewNotification(notice, navigate)
    },
  }, enabled)
}
