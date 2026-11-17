// Builds a multipart/form-data body for app.inject: text fields first (the routes read them from
// file.fields, which only holds fields sent before the file), then the file. The body is built as
// bytes so binary signatures survive; without `content`, the file starts like a real file of its
// extension (the upload refuses content that does not match the extension).
const SAMPLE_BY_EXTENSION: Record<string, Buffer> = {
  pdf: Buffer.from('%PDF-1.4\n%sample\n', 'latin1'),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
}

function sampleFor(filename: string): Buffer {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return SAMPLE_BY_EXTENSION[ext] ?? Buffer.from('conteudo de teste\n', 'utf8')
}

export function multipartBody(
  fields: Record<string, string>,
  file?: { name?: string; filename: string; contentType?: string; content?: string | Buffer },
) {
  const boundary = `boundary-${Math.random().toString(36).slice(2)}`
  const chunks: Buffer[] = Object.entries(fields).map(
    ([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'),
  )
  if (file) {
    const content = file.content === undefined ? sampleFor(file.filename) : Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8')
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name ?? 'file'}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType ?? 'application/pdf'}\r\n\r\n`,
        'utf8',
      ),
      content,
      Buffer.from('\r\n', 'utf8'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--`, 'utf8'))
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(chunks),
  }
}
