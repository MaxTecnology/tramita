import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// Notification links carry `?task=<id>` / `?request=<id>`: hand the id to the screen once, and
// give it a way to drop the param when the item is closed (so a reload does not reopen it).
export function useLinkedItem(param: 'task' | 'request', open: (id: string) => void): () => void {
  const [searchParams, setSearchParams] = useSearchParams()
  const id = searchParams.get(param)
  useEffect(() => {
    if (id) open(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return () => {
    if (!searchParams.has(param)) return
    const next = new URLSearchParams(searchParams)
    next.delete(param)
    setSearchParams(next, { replace: true })
  }
}
