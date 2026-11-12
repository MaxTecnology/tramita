import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { AppError } from '@/errors/AppError'
import { readUpload } from './read-upload'
import { readMultipartField } from './multipart-fields'
import { multipartBody } from '@/test/multipart'

// Tiny isolated app: the helper is exercised through a real multipart parse, not a mock.
const app = Fastify()

beforeAll(async () => {
  await app.register(multipart, { limits: { fileSize: 1024 } })
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ message: err.message })
    return reply.status(500).send({ message: String(err) })
  })
  app.post('/required', async (request) => {
    const { file, upload } = await readUpload(request, { maxBytes: 1024 })
    return { ...upload, buffer: undefined, amount: readMultipartField(file, 'amount') }
  })
  app.post('/optional', async (request) => {
    const result = await readUpload(request, { maxBytes: 1024, optional: true })
    return { hasFile: result !== null }
  })
  await app.ready()
})
afterAll(() => app.close())

const post = (url: string, mp: ReturnType<typeof multipartBody>) =>
  app.inject({ method: 'POST', url, headers: mp.headers, payload: mp.body })

describe('readUpload', () => {
  it('returns the file with the type decided by the extension, plus fields sent before it', async () => {
    const res = await post('/required', multipartBody({ amount: '10.00' }, { filename: 'nota.xml', contentType: 'text/html', content: '<x/>' }))

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ filename: 'nota.xml', mimeType: 'application/xml', size: 4, amount: '10.00' })
  })

  it('refuses a forbidden extension with 422 even when the browser declares PDF', async () => {
    const res = await post('/required', multipartBody({}, { filename: 'pagina.html', contentType: 'application/pdf', content: '<script>' }))

    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).message).toBe('Tipo de arquivo não permitido. Envie PDF, imagem, planilha, documento, texto, CSV, XML, OFX ou ZIP.')
  })

  it('file over the limit answers 413 in Portuguese with the limit of the route', async () => {
    const res = await post('/required', multipartBody({}, { filename: 'grande.pdf', content: 'x'.repeat(2048) }))

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body).message).toBe('Arquivo excede o limite de 1KB')
  })

  it('missing file is 400 when required and null when optional', async () => {
    const required = await post('/required', multipartBody({ amount: '1' }))
    const optional = await post('/optional', multipartBody({ amount: '1' }))

    expect(required.statusCode).toBe(400)
    expect(JSON.parse(required.body).message).toBe('Nenhum arquivo enviado')
    expect(JSON.parse(optional.body)).toEqual({ hasFile: false })
  })
})
