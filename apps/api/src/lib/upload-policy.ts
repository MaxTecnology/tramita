// Single upload policy for every route that stores a user file. The stored type is decided by the
// file extension from this allowlist — never by the Content-Type the browser declares — so a page
// renamed or relabelled as PDF is stored as PDF and can never be served as HTML.
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml', // NF-e, eSocial
  ofx: 'application/x-ofx', // bank statements
  zip: 'application/zip',
}

export const UPLOAD_TYPE_NOT_ALLOWED =
  'Tipo de arquivo não permitido. Envie PDF, imagem, planilha, documento, texto, CSV, XML, OFX ou ZIP.'

export function resolveUploadMimeType(filename: string): string | null {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return null // no extension, or a bare ".pdf"
  return TYPE_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()] ?? null
}

// Types the browser only displays (never executes) may open in a tab; everything else downloads.
const INLINE_SAFE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain', 'text/csv'])

export function contentDispositionFor(mimeType: string): 'inline' | 'attachment' {
  return INLINE_SAFE.has(mimeType) ? 'inline' : 'attachment'
}
