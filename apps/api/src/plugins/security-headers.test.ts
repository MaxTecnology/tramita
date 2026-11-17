import { it, expect } from 'vitest'
import { app } from '@/test/setup'

it('every response carries the security headers (no sniffing, no framing, HTTPS only)', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.headers['x-content-type-options']).toBe('nosniff')
  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
  expect(res.headers['strict-transport-security']).toContain('max-age=')
  expect(res.headers['cross-origin-resource-policy']).toBe('same-site')
  expect(res.headers['x-powered-by']).toBeUndefined()
})
