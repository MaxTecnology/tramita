import { describe, it, expect, vi } from 'vitest'
import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'
import { extrairDocumento, registrarTimeoutSeAplicavel } from './extrair-texto'
import { logger } from '@/lib/logger'

async function gerarPdf(paginas: number, linhas: { texto: string; x: number; y: number }[] = []): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const stream = doc.pipe(new PassThrough())
  const chunks: Buffer[] = []
  stream.on('data', (c) => chunks.push(c))
  for (const l of linhas) doc.fontSize(10).text(l.texto, l.x * doc.page.width, l.y * doc.page.height)
  for (let i = 1; i < paginas; i++) doc.addPage()
  doc.end()
  await new Promise((resolve) => stream.on('end', resolve))
  return new Uint8Array(Buffer.concat(chunks))
}

describe('extrairDocumento', () => {
  it('extrai o texto das páginas com posição normalizada', async () => {
    const pdf = await gerarPdf(1, [{ texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 }])

    const resultado = await extrairDocumento(pdf)

    expect(resultado.temTexto).toBe(true)
    expect(resultado.paginas).toHaveLength(1)
    const textos = resultado.paginas[0].itens.map((i) => i.str).join(' ')
    expect(textos).toContain('Documento de Arrecadação')
  })

  it('marca temTexto como false quando o PDF quase não tem texto', async () => {
    const pdf = await gerarPdf(1)

    const resultado = await extrairDocumento(pdf)

    expect(resultado.temTexto).toBe(false)
  })

  it('rejeita PDF com mais páginas que o limite', async () => {
    const pdf = await gerarPdf(11)

    await expect(extrairDocumento(pdf)).rejects.toThrow(/excede o limite de 10/)
  })
})

describe('registrarTimeoutSeAplicavel', () => {
  it('loga com o marcador pdf_extraction_timeout quando o erro é de timeout', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger)

    registrarTimeoutSeAplicavel(new Error('Timeout de 15000ms excedido na execução isolada'))

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pdf_extraction_timeout' }),
      expect.any(String),
    )
    spy.mockRestore()
  })

  it('não loga quando o erro não é de timeout', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger)

    registrarTimeoutSeAplicavel(new Error('PDF com 11 páginas excede o limite de 10'))

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
