import { parentPort, workerData } from 'node:worker_threads'

parentPort!.postMessage({ ok: true, resultado: workerData })
