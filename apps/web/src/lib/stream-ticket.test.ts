import { afterEach, expect, it, vi } from 'vitest'
import * as refresh from './auth-refresh'
import { openStreamUrl, StreamAuthError } from './stream-ticket'

afterEach(() => vi.restoreAllMocks())

it('a refused session sends the person to login', async () => {
  vi.spyOn(refresh, 'getFreshAccessToken').mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }))
  await expect(openStreamUrl('/boards/b1/stream')).rejects.toBeInstanceOf(StreamAuthError)
})

it('the API unreachable for a moment is a transient failure (the stream retries, no logout)', async () => {
  vi.spyOn(refresh, 'getFreshAccessToken').mockRejectedValue(new Error('Network Error'))
  const err = await openStreamUrl('/boards/b1/stream').catch((e: unknown) => e)
  expect(err).not.toBeInstanceOf(StreamAuthError)
})
