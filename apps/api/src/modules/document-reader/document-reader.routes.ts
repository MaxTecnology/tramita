import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  ingerirDocumento, listarFilaDeRevisao, confirmarSugestao, trocarTarefa, rejeitarDocumento, reabrirDocumento,
  obterMetricas,
} from './document-reader.service'
import { trocarTarefaBodySchema } from './document-reader.schema'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function documentReaderRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', verifyJWT)

  app.post('/document-reader/upload', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')
    if (file.mimetype !== 'application/pdf') {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Só PDF é aceito')
    }

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const doc = await ingerirDocumento(request.user.organizationId!, { id: request.user.sub }, {
      filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer,
    })
    return reply.status(201).send(doc)
  })

  app.get('/document-reader/fila', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await listarFilaDeRevisao(request.user.organizationId!))
  })

  app.get('/document-reader/metricas', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await obterMetricas(request.user.organizationId!))
  })

  app.post('/document-reader/:id/confirmar', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await confirmarSugestao(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role }))
  })

  app.post('/document-reader/:id/trocar-tarefa', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = trocarTarefaBodySchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await trocarTarefa(id, request.user.organizationId!, result.data.taskId, { id: request.user.sub, role: request.user.role }))
  })

  app.post('/document-reader/:id/rejeitar', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await rejeitarDocumento(id, request.user.organizationId!, { id: request.user.sub, role: request.user.role })
    return reply.status(204).send()
  })

  app.post('/document-reader/:id/reabrir', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await reabrirDocumento(id, request.user.organizationId!)
    return reply.status(204).send()
  })
}
