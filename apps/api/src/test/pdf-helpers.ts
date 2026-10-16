import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

export async function gerarPdfComDocumentoArrecadacao(
  cnpj: string,
  competencia: string,
  numeroDocumento?: string,
): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const stream = doc.pipe(new PassThrough())
  const chunks: Buffer[] = []
  stream.on('data', (c) => chunks.push(c))
  if (cnpj) doc.fontSize(10).text('Documento de Arrecadação', 0.1 * doc.page.width, 0.05 * doc.page.height)
  if (cnpj) doc.fontSize(10).text(cnpj, 0.1 * doc.page.width, 0.1 * doc.page.height)
  if (competencia) doc.fontSize(10).text(competencia, 0.1 * doc.page.width, 0.15 * doc.page.height)
  if (numeroDocumento) doc.fontSize(10).text(numeroDocumento, 0.1 * doc.page.width, 0.2 * doc.page.height)
  doc.end()
  await new Promise((resolve) => stream.on('end', resolve))
  return new Uint8Array(Buffer.concat(chunks))
}
