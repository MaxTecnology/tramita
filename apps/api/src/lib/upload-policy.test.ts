import { describe, it, expect } from 'vitest'
import { resolveUploadMimeType, contentDispositionFor } from './upload-policy'

describe('resolveUploadMimeType', () => {
  it.each([
    ['guia.pdf', 'application/pdf'],
    ['GUIA.PDF', 'application/pdf'],
    ['foto.JPG', 'image/jpeg'],
    ['foto.jpeg', 'image/jpeg'],
    ['nota-fiscal.xml', 'application/xml'],
    ['extrato.ofx', 'application/x-ofx'],
    ['folha.csv', 'text/csv'],
    ['balancete.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['contrato.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['notas.zip', 'application/zip'],
  ])('%s is accepted as %s, whatever the browser declared', (filename, mime) => {
    expect(resolveUploadMimeType(filename)).toBe(mime)
  })

  it.each(['virus.exe', 'pagina.html', 'pagina.htm', 'logo.svg', 'script.js', 'guia.pdf.exe', 'semextensao', '.pdf', ''])(
    '%s is refused',
    (filename) => {
      expect(resolveUploadMimeType(filename)).toBeNull()
    },
  )
})

describe('contentDispositionFor', () => {
  it('PDF, images and plain text open in the browser', () => {
    expect(contentDispositionFor('application/pdf')).toBe('inline')
    expect(contentDispositionFor('image/png')).toBe('inline')
    expect(contentDispositionFor('text/plain')).toBe('inline')
  })

  it('XML, Office files, ZIP and anything unknown are forced to download', () => {
    expect(contentDispositionFor('application/xml')).toBe('attachment')
    expect(contentDispositionFor('application/zip')).toBe('attachment')
    expect(contentDispositionFor('application/vnd.ms-excel')).toBe('attachment')
    expect(contentDispositionFor('text/html')).toBe('attachment')
  })
})
