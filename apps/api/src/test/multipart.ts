// Builds a multipart/form-data body for app.inject: text fields first (the routes read them from
// file.fields, which only holds fields sent before the file), then the file.
export function multipartBody(
  fields: Record<string, string>,
  file?: { name?: string; filename: string; contentType?: string; content?: string },
) {
  const boundary = `boundary-${Math.random().toString(36).slice(2)}`
  const parts = Object.entries(fields).map(
    ([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
  )
  if (file) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name ?? 'file'}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? 'application/pdf'}\r\n\r\n${file.content ?? '%PDF-1.4'}\r\n`,
    )
  }
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: `${parts.join('')}--${boundary}--`,
  }
}
