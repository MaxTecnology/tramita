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

// The extension decides the stored type; the first bytes must agree with it, so an executable or a
// page renamed to ".pdf" is refused instead of stored as a document.
const startsWith = (buffer: Buffer, ...signature: number[]) => signature.every((b, i) => buffer[i] === b)
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const ZIP = [0x50, 0x4b, 0x03, 0x04] // docx, xlsx, zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] // legacy doc, xls

const SIGNATURE_CHECK: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => startsWith(b, ...ascii('%PDF-')),
  'image/png': (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/jpeg': (b) => startsWith(b, 0xff, 0xd8, 0xff),
  'image/gif': (b) => startsWith(b, ...ascii('GIF8')),
  'image/webp': (b) => startsWith(b, ...ascii('RIFF')) && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/msword': (b) => startsWith(b, ...OLE),
  'application/vnd.ms-excel': (b) => startsWith(b, ...OLE),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => startsWith(b, ...ZIP),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => startsWith(b, ...ZIP),
  'application/zip': (b) => startsWith(b, ...ZIP),
}

// Text types (txt, csv, xml, ofx): no binary content (a NUL byte in the first 8 KB)
const looksLikeText = (b: Buffer) => b.length > 0 && !b.subarray(0, 8192).includes(0)

export function contentMatchesType(mimeType: string, buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  const check = SIGNATURE_CHECK[mimeType]
  return check ? check(buffer) : looksLikeText(buffer)
}

export const UPLOAD_CONTENT_MISMATCH = 'O conteúdo do arquivo não confere com a extensão dele. Envie o arquivo original.'
