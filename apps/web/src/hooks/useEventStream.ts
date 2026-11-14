import { useEffect, useRef } from 'react'
import { redirectToLogin } from '@/lib/auth-refresh'
import { openStreamUrl, StreamAuthError } from '@/lib/stream-ticket'

// One SSE connection (ticket auth, exponential back-off, heartbeat resets the back-off).
// `listeners` is read through a ref, so callers can pass a fresh object every render.
export function useEventStream(path: string, listeners: Record<string, () => void>, enabled = true): void {
  const listenersRef = useRef(listeners)
  listenersRef.current = listeners
  const esRef = useRef<EventSource | null>(null)
  const retryDelay = useRef(1000)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
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
          url = await openStreamUrl(path)
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
        for (const name of Object.keys(listenersRef.current)) {
          es.addEventListener(name, () => listenersRef.current[name]?.())
        }
        es.addEventListener('heartbeat', () => { retryDelay.current = 1000 })
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
  }, [path, enabled])
}
