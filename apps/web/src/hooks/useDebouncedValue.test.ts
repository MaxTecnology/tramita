import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('only exposes the latest value after the user stops typing', () => {
  const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: 'an' } })
  expect(result.current).toBe('an')

  rerender({ v: 'ana' })
  act(() => { vi.advanceTimersByTime(200) })
  rerender({ v: 'anal' })
  act(() => { vi.advanceTimersByTime(200) })
  expect(result.current).toBe('an')

  act(() => { vi.advanceTimersByTime(100) })
  expect(result.current).toBe('anal')
})
