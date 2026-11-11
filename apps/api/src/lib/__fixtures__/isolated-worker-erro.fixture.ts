import { parentPort } from 'node:worker_threads'

parentPort!.postMessage({ ok: false, erro: 'falha proposital do fixture' })
