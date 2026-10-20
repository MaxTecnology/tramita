import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export function useRequestsBadgeStream(): void {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return

      const token = localStorage.getItem('accessToken')
      if (!token) return

      // 50ms delay prevents React StrictMode double-invocation from opening two
      // simultaneous connections — cleanup cancels the timer before EventSource opens
      connectTimerRef.current = setTimeout(() => {
        if (cancelled) return

        const es = new EventSource(`${BASE_URL}/requests/stream?token=${token}`)
        esRef.current = es

        es.addEventListener('request:changed', () => {
          queryClient.invalidateQueries({ queryKey: ['requests-pending-count'] })
          // Cobre aprovar/rejeitar/cancelar e o auto-revert de NEEDS_INFO quando o cliente
          // responde — sem isso a lista de Solicitações (e qualquer painel de comentários aberto)
          // só atualiza no próximo refetch espontâneo, não quando o evento realmente acontece.
          // O evento não carrega o id da request afetada, então 'request-comments' sem id
          // invalida por prefixo — qualquer painel de comentários aberto, de qualquer request.
          queryClient.invalidateQueries({ queryKey: ['requests'] })
          queryClient.invalidateQueries({ queryKey: ['request-comments'] })
        })

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
  }, [queryClient])
}
