import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export function useBoardStream(boardId: string | undefined) {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    if (!boardId) return

    let cancelled = false

    function connect() {
      if (cancelled) return

      const token = localStorage.getItem('accessToken')
      if (!token) return

      const es = new EventSource(`${BASE_URL}/boards/${boardId}/stream?token=${token}`)
      esRef.current = es

      const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['board', boardId] })
        queryClient.invalidateQueries({ queryKey: ['portal-board', boardId] })
      }

      es.addEventListener('task:moved', invalidate)
      es.addEventListener('task:created', invalidate)
      es.addEventListener('task:updated', invalidate)
      es.addEventListener('comment:added', invalidate)

      es.addEventListener('heartbeat', () => {
        retryDelay.current = 1000 // reset backoff on successful heartbeat
      })

      es.onerror = () => {
        es.close()
        esRef.current = null
        if (cancelled) return
        const delay = retryDelay.current
        retryDelay.current = Math.min(delay * 2, 30_000)
        setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      esRef.current?.close()
      esRef.current = null
    }
  }, [boardId, queryClient])
}
