import pino from 'pino'

// Shared structured logger for code that runs outside a Fastify request context
// (services, cron/worker jobs) and therefore has no access to `app.log`/`request.log`.
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
})
