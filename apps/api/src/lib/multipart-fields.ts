import type { MultipartFile } from '@fastify/multipart'

// Text field sent in the same multipart request as the file. Only fields sent BEFORE the file are
// available here — @fastify/multipart accumulates `file.fields` as the stream goes.
export function readMultipartField(file: MultipartFile, name: string): string | undefined {
  const field = file.fields[name]
  if (!field || Array.isArray(field) || field.type !== 'field') return undefined
  const value = String(field.value).trim()
  return value === '' ? undefined : value
}
