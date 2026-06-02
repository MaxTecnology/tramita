import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyInstance } from 'fastify'

export default fp(async function (app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://tramita.autohubs.com.br']
      : true,
    credentials: true,
  })
})
