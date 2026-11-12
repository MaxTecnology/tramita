import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFreshAccessToken, isTokenExpired, refreshAccessToken } from './auth-refresh'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
const post = vi.mocked(axios.post)

function jwtWithExp(expSecondsFromNow: number): string {
  const payload = { sub: 'u1', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
}

describe('isTokenExpired', () => {
  it('treats tokens expiring within the skew window as expired', () => {
    expect(isTokenExpired(jwtWithExp(600))).toBe(false)
    expect(isTokenExpired(jwtWithExp(10))).toBe(true)
    expect(isTokenExpired(jwtWithExp(-60))).toBe(true)
  })

  it('treats malformed tokens as expired', () => {
    expect(isTokenExpired('not-a-jwt')).toBe(true)
  })
})

describe('refreshAccessToken', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('refreshToken', 'r1')
    post.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('shares one /auth/refresh call between concurrent callers', async () => {
    let resolve: (v: unknown) => void = () => {}
    post.mockReturnValue(new Promise((r) => { resolve = r }) as never)

    const calls = Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])
    resolve({ data: { accessToken: 'new-token' } })

    expect(await calls).toEqual(['new-token', 'new-token', 'new-token'])
    expect(post).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('accessToken')).toBe('new-token')
  })

  it('allows a new refresh after the previous one settled', async () => {
    post.mockResolvedValueOnce({ data: { accessToken: 'a' } } as never)
    post.mockResolvedValueOnce({ data: { accessToken: 'b' } } as never)

    expect(await refreshAccessToken()).toBe('a')
    expect(await refreshAccessToken()).toBe('b')
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('clears the session and rejects when refresh fails', async () => {
    localStorage.setItem('accessToken', 'old')
    localStorage.setItem('user', '{}')
    post.mockRejectedValueOnce(new Error('401'))

    await expect(refreshAccessToken()).rejects.toThrow()
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })
})

describe('getFreshAccessToken', () => {
  beforeEach(() => {
    localStorage.clear()
    post.mockReset()
  })

  it('returns the stored token without refreshing while it is valid', async () => {
    const valid = jwtWithExp(600)
    localStorage.setItem('accessToken', valid)

    expect(await getFreshAccessToken()).toBe(valid)
    expect(post).not.toHaveBeenCalled()
  })

  it('refreshes an expired token before handing it out (SSE reconnect after idle)', async () => {
    localStorage.setItem('accessToken', jwtWithExp(-60))
    localStorage.setItem('refreshToken', 'r1')
    post.mockResolvedValueOnce({ data: { accessToken: 'fresh' } } as never)

    expect(await getFreshAccessToken()).toBe('fresh')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('returns null when there is no session', async () => {
    expect(await getFreshAccessToken()).toBeNull()
  })
})
