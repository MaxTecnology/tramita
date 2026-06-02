import Fastify from 'fastify'
import corsPlugin from '@/plugins/cors'
import rateLimitPlugin from '@/plugins/rate-limit'
import { authRoutes } from '@/modules/auth/auth.routes'
import { masterRoutes } from '@/modules/master/index'
import { publicOrgRoutes, orgRoutes } from '@/modules/organizations/organizations.routes'
import { webhooksRoutes } from '@/modules/webhooks/webhooks.routes'
import { usersRoutes } from '@/modules/users/users.routes'
import { clientsRoutes } from '@/modules/clients/clients.routes'
import { boardsRoutes } from '@/modules/boards/boards.routes'
import { columnsRoutes } from '@/modules/columns/columns.routes'
import { tasksRoutes } from '@/modules/tasks/tasks.routes'
import { commentsRoutes } from '@/modules/comments/comments.routes'
import { AppError } from '@/errors/AppError'

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(corsPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(authRoutes, { prefix: '/auth' })
  app.register(masterRoutes, { prefix: '/master' })
  app.register(publicOrgRoutes, { prefix: '/organizations' })
  app.register(orgRoutes, { prefix: '/org' })
  app.register(webhooksRoutes, { prefix: '/webhooks' })
  app.register(usersRoutes, { prefix: '/users' })
  app.register(clientsRoutes, { prefix: '/clients' })
  app.register(boardsRoutes, { prefix: '/boards' })
  app.register(columnsRoutes)
  app.register(tasksRoutes)
  app.register(commentsRoutes)

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
