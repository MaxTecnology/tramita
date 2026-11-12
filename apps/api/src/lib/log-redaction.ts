import type { FastifyRequest } from 'fastify'

// Query params that carry credentials. SSE endpoints receive a one-time ?ticket= (formerly the JWT as ?token=)
// because EventSource cannot send an Authorization header.
const SENSITIVE_PARAMS = ['token', 'ticket', 'access_token', 'accesstoken', 'refresh_token']

const SENSITIVE_PARAM_RE = new RegExp(`([?&](?:${SENSITIVE_PARAMS.join('|')})=)[^&#]*`, 'gi') // case-insensitive: ?accessToken= (Asaas webhook)

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE_PARAM_RE, '$1[REDACTED]')
}

// Same fields as Fastify's default `req` serializer, with the URL redacted.
export function buildLoggerOptions() {
  return {
    serializers: {
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
        }
      },
    },
  }
}
