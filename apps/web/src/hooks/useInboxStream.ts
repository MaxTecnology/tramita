import { useQueryClient } from '@tanstack/react-query'
import { useEventStream } from './useEventStream'
import { UNREAD_KEY, LIST_KEY } from '@/components/shared/notifications'

// Bell in real time: the person's own channel. A new notice also refreshes open conversations
// and the portal month/home (unread counters), since most notices are comments or approvals.
export function useInboxStream(enabled = true): void {
  const queryClient = useQueryClient()
  useEventStream('/notifications/stream', {
    'inbox:changed': () => {
      for (const queryKey of [UNREAD_KEY, LIST_KEY, ['comments'], ['request-comments'], ['portal-requests-month'], ['portal-home'], ['task-approvals']]) {
        queryClient.invalidateQueries({ queryKey })
      }
    },
  }, enabled)
}
