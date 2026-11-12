import { Writable } from 'node:stream'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildLoggerOptions, redactUrl } from './log-redaction'

describe('redactUrl', () => {
  it('masks the token query param and keeps the rest of the URL', () => {
    expect(redactUrl('/requests/stream?token=eyJabc.def.ghi')).toBe('/requests/stream?token=[REDACTED]')
    expect(redactUrl('/boards/b1/stream?x=1&token=eyJ&y=2')).toBe('/boards/b1/stream?x=1&token=[REDACTED]&y=2')
  })

  it('masks other credential-like params', () => {
    expect(redactUrl('/a?access_token=s1&refresh_token=s2')).toBe('/a?access_token=[REDACTED]&refresh_token=[REDACTED]')
    expect(redactUrl('/requests/stream?ticket=abc123')).toBe('/requests/stream?ticket=[REDACTED]')
  })

  it('leaves URLs without sensitive params untouched', () => {
    expect(redactUrl('/clients?search=acme&page=2')).toBe('/clients?search=acme&page=2')
    expect(redactUrl('/health')).toBe('/health')
  })

  it('does not mask params that only contain "token" in their name', () => {
    expect(redactUrl('/a?tokenized=1')).toBe('/a?tokenized=1')
  })
})

describe('buildLoggerOptions', () => {
  it('never writes the SSE token to the request log line', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, cb) { lines.push(chunk.toString()); cb() },
    })
    const app = Fastify({ logger: { ...buildLoggerOptions(), stream } })
    app.get('/requests/stream', async () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'GET', url: '/requests/stream?token=eyJsecret.payload.sig' })
    await app.close()

    const log = lines.join('')
    expect(log).toContain('/requests/stream?token=[REDACTED]')
    expect(log).not.toContain('eyJsecret')
  })
})
