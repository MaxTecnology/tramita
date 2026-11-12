import type { FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { AppError } from '@/errors/AppError'
import { resolveUploadMimeType, UPLOAD_TYPE_NOT_ALLOWED } from './upload-policy'

export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024

export interface UploadedFile {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

interface ReadUploadOptions {
  maxBytes?: number
  optional?: boolean
}

function limitLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))}MB` : `${Math.round(bytes / 1024)}KB`
}

function isTooLarge(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string }
  return e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE'
}

// Reads the single file of a multipart request applying the upload policy (allowlisted extension,
// size limit, pt-BR errors). `file` is returned so callers can read the text fields sent before it.
// The size limit must match the one the route registered @fastify/multipart with.
export async function readUpload(
  request: FastifyRequest,
  opts: ReadUploadOptions & { optional: true },
): Promise<{ file: MultipartFile; upload: UploadedFile } | null>
export async function readUpload(
  request: FastifyRequest,
  opts?: ReadUploadOptions,
): Promise<{ file: MultipartFile; upload: UploadedFile }>
export async function readUpload(request: FastifyRequest, opts: ReadUploadOptions = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  const tooLarge = () => new AppError(413, `Arquivo excede o limite de ${limitLabel(maxBytes)}`)

  let file: MultipartFile | undefined
  try {
    file = await request.file()
  } catch (err) {
    if (isTooLarge(err)) throw tooLarge()
    throw err
  }
  if (!file) {
    if (opts.optional) return null
    throw new AppError(400, 'Nenhum arquivo enviado')
  }

  const mimeType = resolveUploadMimeType(file.filename)
  if (!mimeType) {
    await file.toBuffer().catch(() => {}) // drain the stream before answering
    throw new AppError(422, UPLOAD_TYPE_NOT_ALLOWED)
  }

  let buffer: Buffer
  try {
    // toBuffer() is where @fastify/multipart actually throws the size overflow
    buffer = await file.toBuffer()
  } catch (err) {
    if (isTooLarge(err)) throw tooLarge()
    throw err
  }
  if (buffer.length > maxBytes) throw tooLarge()

  return { file, upload: { filename: file.filename, mimeType, size: buffer.length, buffer } }
}
