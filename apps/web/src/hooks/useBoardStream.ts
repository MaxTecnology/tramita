import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getFreshAccessToken, redirectToLogin } from '@/lib/auth-refresh'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export function useBoardStream(boardId: string | undefined) {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!boardId) return

    let cancelled = false

    function connect() {
      if (cancelled) return

      // 50ms delay prevents React StrictMode double-invocation from opening two
      // simultaneous connections — cleanup cancels the timer before EventSource opens
      connectTimerRef.current = setTimeout(async () => {
        if (cancelled) return

        // EventSource can't see a 401 nor refresh on its own: after the tab sits idle the
        // stored token is expired, so refresh it here before (re)connecting.
        let token: string | null
        try {
          token = await getFreshAccessToken()
        } catch {
          redirectToLogin()
          return
        }
        if (!token || cancelled) return

        const es = new EventSource(`${BASE_URL}/boards/${boardId}/stream?token=${token}`)
        esRef.current = es

        const invalidate = () => {
          queryClient.invalidateQueries({ queryKey: ['board', boardId] })
          queryClient.invalidateQueries({ queryKey: ['portal-board', boardId] })
          queryClient.invalidateQueries({ queryKey: ['boards'] })
        }

        es.addEventListener('task:moved', invalidate)
        es.addEventListener('task:created', invalidate)
        es.addEventListener('task:updated', invalidate)
        es.addEventListener('comment:added', invalidate)

        es.addEventListener('heartbeat', () => {
          retryDelay.current = 1000
        })

        es.onerror = () => {
          es.close()
          esRef.current = null
          if (cancelled) return
          const delay = retryDelay.current
          retryDelay.current = Math.min(delay * 2, 30_000)
          setTimeout(connect, delay)
        }
      }, 50)
    }

    connect()

    return () => {
      cancelled = true
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [boardId, queryClient])
}
