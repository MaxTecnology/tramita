// apps/api/src/modules/document-reader/document-reader-models.routes.ts
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import {
  criarObligationType, analisarPdfParaModelagem, listarModelos, criarModelo, atualizarModelo, arquivarModelo,
  verificarColisaoModelo,
} from './document-reader-models.service'
import { createObligationTypeSchema, criarModeloSchema, atualizarModeloSchema, verificarColisaoSchema } from './document-reader-models.schema'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function documentReaderModelsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })
  app.addHook('preHandler', verifyJWT)
  // Toda rota deste arquivo é ORG_ADMIN-only (inclusive leitura) — só quem administra o
  // escritório mexe em modelo. Ao contrário de os-templates.routes.ts (que mistura leitura
  // ampla com escrita restrita), aqui TODAS as rotas têm a mesma exigência de role, então um
  // addHook global é seguro e mais simples que repetir requireRole('ORG_ADMIN') em cada rota.
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/document-reader/obrigacoes', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createObligationTypeSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await criarObligationType(request.user.organizationId!, { id: request.user.sub }, result.data))
  })

  app.post('/document-reader/modelos/analisar', async (request, reply) => {
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
    // file.toBuffer() é onde o @fastify/multipart de fato lança o estouro de limite
    // (FST_REQ_FILE_TOO_LARGE, lido do stream durante a leitura) — request.file() só abre o
    // stream, não lê o conteúdo. Por isso o try/catch precisa envolver o toBuffer(), não só o
    // request.file() acima; sem isso o erro cru do plugin (413, mensagem em inglês) vazava pro
    // cliente.
    let buffer: Buffer
    try {
      buffer = await file.toBuffer()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }

    return reply.send(await analisarPdfParaModelagem(buffer))
  })

  app.get('/document-reader/modelos', async (request, reply) => {
    return reply.send(await listarModelos(request.user.organizationId!))
  })

  app.post('/document-reader/modelos/verificar-colisao', async (request, reply) => {
    const result = verificarColisaoSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const modelosColidentes = await verificarColisaoModelo(
      request.user.organizationId!, result.data.paginas, result.data.ancoras, result.data.excluirModeloId,
    )
    return reply.send({ modelosColidentes })
  })

  app.post('/document-reader/modelos', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = criarModeloSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await criarModelo(request.user.organizationId!, { id: request.user.sub }, result.data))
  })

  app.patch('/document-reader/modelos/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = atualizarModeloSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await atualizarModelo(id, request.user.organizationId!, result.data))
  })

  app.delete('/document-reader/modelos/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await arquivarModelo(id, request.user.organizationId!)
    return reply.status(204).send()
  })
}
