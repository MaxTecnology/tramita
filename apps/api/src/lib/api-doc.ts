import type { ZodTypeAny } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { RouteDoc } from '@/api-docs/types'
import { DEFAULT_MAX_UPLOAD_BYTES } from '@/lib/read-upload'

// The default upload policy (lib/upload-policy, lib/read-upload), said once for every upload route
const DEFAULT_FILE = `Um arquivo de até ${DEFAULT_MAX_UPLOAD_BYTES / (1024 * 1024)} MB: PDF, imagem (JPG, PNG, GIF, WebP), Word, Excel, TXT, CSV, XML, OFX ou ZIP. O conteúdo precisa bater com a extensão.`

// Turns a catalog entry into the route schema @fastify/swagger reads. Used only by the OpenAPI
// transform: routes never get these schemas, so Fastify validates nothing with them and the
// handler's own Zod parsing keeps its answers.

// JSON Schema draft 7 is the OpenAPI 3.1 dialect ('openApi3' would emit 3.0's `nullable`)
function json(schema: ZodTypeAny) {
  const { $schema: _draft, ...rest } = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' })
  return rest
}

export function toRouteSchema(doc: RouteDoc): Record<string, unknown> {
  const schema: Record<string, unknown> = { summary: doc.summary }
  if (doc.description) schema.description = doc.description
  if (doc.querystring) schema.querystring = json(doc.querystring)
  if (doc.upload) {
    const fields = Object.fromEntries(Object.entries(doc.upload.fields ?? {}).map(([name, description]) => [name, { type: 'string', description }]))
    schema.consumes = ['multipart/form-data']
    schema.body = { type: 'object', required: ['file'], properties: { ...fields, file: { type: 'string', format: 'binary', description: doc.upload.file ?? DEFAULT_FILE } } }
  } else if (doc.body) {
    schema.body = json(doc.body)
  }
  return schema
}
