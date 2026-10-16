import { readFile } from 'node:fs/promises'
// @ts-ignore - build legacy roda em Node sem polyfills
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentoExtraido, Item, Pagina } from './types'

const MAX_PAGINAS = 10
const TIMEOUT_MS = 15_000

/**
 * Lê o PDF e devolve cada trecho de texto com posição normalizada (0..1).
 * Se o PDF quase não tem texto, `temTexto` = false (candidato a OCR).
 * PDF é entrada não confiável: isEvalSupported desligado, limite de páginas e timeout.
 */
export async function extrairDocumento(entrada: string | Uint8Array): Promise<DocumentoExtraido> {
  const data = typeof entrada === 'string' ? new Uint8Array(await readFile(entrada)) : entrada

  // isEvalSupported é uma opção real do pdf.js (desliga otimizações baseadas em eval — importante
  // porque o PDF é entrada não confiável), mas falta no .d.ts desta versão — daí o `as any`.
  const loadingTask = getDocument({ data, useSystemFonts: true, verbosity: 0, isEvalSupported: false } as any)

  // Se o timeout estourar (ou qualquer outro erro acontecer), destroy() na loading task aborta o
  // worker interno do pdf.js em vez de deixar o parse rodando em segundo plano (CPU/memória) pelo
  // resto da vida do worker do document-reader. Não é isolamento de processo de verdade (a spec
  // original pedia processo/worker_thread separado — não implementado aqui, ver ledger) — um laço
  // síncrono dentro do pdf.js ainda bloqueia o event loop antes de ceder pro timeout disparar. É
  // uma rede de segurança parcial, não total.
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      extrairSemLimite(loadingTask),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Timeout ao extrair texto do PDF')), TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    await loadingTask.destroy().catch(() => {})
    throw err
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function extrairSemLimite(loadingTask: { promise: Promise<any> }): Promise<DocumentoExtraido> {
  const pdf = await loadingTask.promise

  if (pdf.numPages > MAX_PAGINAS) {
    throw new Error(`PDF com ${pdf.numPages} páginas excede o limite de ${MAX_PAGINAS}`)
  }

  const paginas: Pagina[] = []
  let totalChars = 0

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const W = vp.width
    const H = vp.height
    const content = await page.getTextContent()

    const itens: Item[] = []
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue
      const [, , , d, e, f] = it.transform as number[]
      const h = it.height || Math.abs(d)
      itens.push({
        str: it.str,
        x: e / W,
        y: (H - f - h) / H, // topo do trecho, origem no topo
        w: it.width / W,
        h: h / H,
      })
      totalChars += it.str.trim().length
    }
    paginas.push({ numero: n, itens, largura: W, altura: H })
  }

  return { paginas, temTexto: totalChars >= 20 }
}
