import Fastify from 'fastify'
import corsPlugin from '@/plugins/cors'
import rateLimitPlugin from '@/plugins/rate-limit'
import { authRoutes } from '@/modules/auth/auth.routes'
import { masterRoutes } from '@/modules/master/index'
import { AppError } from '@/errors/AppError'

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  })

  app.register(corsPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(authRoutes, { prefix: '/auth' })
  app.register(masterRoutes, { prefix: '/master' })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    if (error.statusCode) {
      return reply.status(error.statusCode).send({ message: error.message })
    }
    app.log.error(error)
    return reply.status(500).send({ message: 'Erro interno do servidor' })
  })

  return app
}
