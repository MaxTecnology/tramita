import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { redirectToLogin } from '@/lib/auth-refresh'
import { openStreamUrl, StreamAuthError } from '@/lib/stream-ticket'

export function useRequestsBadgeStream(): void {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    function scheduleRetry() {
      if (cancelled) return
      const delay = retryDelay.current
      retryDelay.current = Math.min(delay * 2, 30_000)
      setTimeout(connect, delay)
    }

    function connect() {
      if (cancelled) return

      // 50ms delay prevents React StrictMode double-invocation from opening two
      // simultaneous connections — cleanup cancels the timer before EventSource opens
      connectTimerRef.current = setTimeout(async () => {
        if (cancelled) return

        let url: string | null
        try {
          url = await openStreamUrl(`/requests/stream`)
        } catch (err) {
          if (err instanceof StreamAuthError) {
            redirectToLogin()
            return
          }
          scheduleRetry() // ticket request failed (network/5xx): try again with backoff
          return
        }
        if (!url || cancelled) return

        const es = new EventSource(url)
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
          scheduleRetry()
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
