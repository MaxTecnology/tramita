import { useEffect, useState } from 'react'

// Returns `value` only after it stopped changing for `delayMs` — for search-as-you-type,
// so the API is hit once per pause instead of once per keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
