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
// Text/CSV download too: a browser that sniffs content could render HTML written inside them.
const INLINE_SAFE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function contentDispositionFor(mimeType: string): 'inline' | 'attachment' {
  return INLINE_SAFE.has(mimeType) ? 'inline' : 'attachment'
}

// File name as it goes into the B2 key: only [A-Za-z0-9._-] (anything else becomes "_"), at most 120
// characters keeping the extension. The original name stays in the database for display/download.
const MAX_KEY_NAME = 120
export function storageSafeName(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_') || 'arquivo'
  if (safe.length <= MAX_KEY_NAME) return safe
  const dot = safe.lastIndexOf('.')
  const ext = dot > 0 ? safe.slice(dot).slice(0, 16) : ''
  return safe.slice(0, MAX_KEY_NAME - ext.length) + ext
}
