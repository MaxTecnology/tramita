import { readFile } from 'node:fs/promises'
import type { DocumentoExtraido } from './types'
import { executarIsolado } from '@/lib/isolated-worker'
import { logger } from '@/lib/logger'

const TIMEOUT_MS = 15_000

// `import.meta.url` termina em `.ts` rodando via tsx (dev/teste) e em `.js` no build de produção
// (tsc + tsc-alias) — só no primeiro caso a worker_thread precisa registrar o loader do tsx pra
// conseguir carregar um módulo TypeScript puro; em produção o arquivo já é JS compilado.
const RODANDO_COMO_TS = import.meta.url.endsWith('.ts')
const WORKER_PATH = new URL(`./extrair-texto-worker${RODANDO_COMO_TS ? '.ts' : '.js'}`, import.meta.url)
const WORKER_OPTIONS = RODANDO_COMO_TS ? { execArgv: ['--import', 'tsx'] } : {}

/**
 * Lê o PDF e devolve cada trecho de texto com posição normalizada (0..1).
 * Se o PDF quase não tem texto, `temTexto` = false (candidato a OCR).
 * PDF é entrada não confiável: roda isolado numa worker_thread própria, com timeout — um laço
 * síncrono travado dentro do pdf.js (PDF patológico) é interrompido via `worker.terminate()`
 * (ver `isolated-worker.ts`) em vez de bloquear o processo inteiro (compartilhado com o worker de
 * notificações de WhatsApp/email).
 */
export async function extrairDocumento(entrada: string | Uint8Array): Promise<DocumentoExtraido> {
  const data = typeof entrada === 'string' ? new Uint8Array(await readFile(entrada)) : entrada

  try {
    return await executarIsolado<DocumentoExtraido>(WORKER_PATH, data, TIMEOUT_MS, WORKER_OPTIONS)
  } catch (err) {
    registrarTimeoutSeAplicavel(err)
    throw err
  }
}

/** Log destacado pra monitoramento — sem Sentry/Datadog integrado, o marcador de evento nos logs
 *  estruturados do Pino é o jeito de notar esse caso em produção. */
export function registrarTimeoutSeAplicavel(err: unknown): void {
  if (err instanceof Error && err.message.startsWith('Timeout de')) {
    logger.error({ event: 'pdf_extraction_timeout', message: err.message }, 'Extração de PDF interrompida por timeout — worker isolado encerrado')
  }
}
