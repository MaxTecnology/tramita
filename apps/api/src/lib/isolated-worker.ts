import { Worker, type WorkerOptions } from 'node:worker_threads'

export type ResultadoWorker<T> =
  | { ok: true; resultado: T }
  | { ok: false; erro: string }

/**
 * Roda `workerPath` numa worker_thread isolada e espera uma única mensagem de volta no formato
 * `ResultadoWorker<T>`. Se o timeout estourar, mata a thread com `terminate()` — que interrompe
 * até um laço síncrono travado (ex: parser de entrada não confiável preso num PDF patológico),
 * ao contrário de só tentar cancelar a operação internamente.
 */
export async function executarIsolado<T>(
  workerPath: string | URL,
  workerData: unknown,
  timeoutMs: number,
  options: WorkerOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(workerPath, { ...options, workerData })
    let settled = false

    const timeoutId = setTimeout(() => {
      concluir(() => {
        worker.terminate().catch(() => {})
        reject(new Error(`Timeout de ${timeoutMs}ms excedido na execução isolada`))
      })
    }, timeoutMs)

    function concluir(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      fn()
    }

    worker.once('message', (msg: ResultadoWorker<T>) => {
      concluir(() => {
        worker.terminate().catch(() => {})
        if (msg.ok) resolve(msg.resultado)
        else reject(new Error(msg.erro))
      })
    })

    worker.once('error', (err) => {
      concluir(() => {
        worker.terminate().catch(() => {})
        reject(err)
      })
    })

    worker.once('exit', (code) => {
      concluir(() => {
        reject(new Error(`Worker encerrou inesperadamente (code ${code})`))
      })
    })
  })
}
