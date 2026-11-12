import { describe, it, expect } from 'vitest'
import { resolveUploadMimeType, contentDispositionFor, storageSafeName } from './upload-policy'

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
  it('PDF and images open in the browser', () => {
    expect(contentDispositionFor('application/pdf')).toBe('inline')
    expect(contentDispositionFor('image/png')).toBe('inline')
  })

  it('text and CSV download (a browser that sniffs could render HTML inside them)', () => {
    expect(contentDispositionFor('text/plain')).toBe('attachment')
    expect(contentDispositionFor('text/csv')).toBe('attachment')
  })

  it('XML, Office files, ZIP and anything unknown are forced to download', () => {
    expect(contentDispositionFor('application/xml')).toBe('attachment')
    expect(contentDispositionFor('application/zip')).toBe('attachment')
    expect(contentDispositionFor('application/vnd.ms-excel')).toBe('attachment')
    expect(contentDispositionFor('text/html')).toBe('attachment')
  })
})

describe('storageSafeName', () => {
  it('keeps letters, digits, dot, dash and underscore; replaces the rest', () => {
    expect(storageSafeName('Guia DAS #1 (out).pdf')).toBe('Guia_DAS__1__out_.pdf')
    expect(storageSafeName('relatório.pdf')).toBe('relat_rio.pdf')
  })

  it('caps the length keeping the extension', () => {
    const name = storageSafeName(`${'a'.repeat(500)}.xlsx`)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.xlsx')).toBe(true)
  })
})
