import { describe, it, expect, vi } from 'vitest'
import { processDocumentReaderJob } from './document-reader.worker'
import * as service from '@/modules/document-reader/document-reader.service'

describe('processDocumentReaderJob', () => {
  it('chama processarDocumento com o id do job', async () => {
    const spy = vi.spyOn(service, 'processarDocumento').mockResolvedValue()
    await processDocumentReaderJob({ data: { receivedDocumentId: 'doc-1' } })
    expect(spy).toHaveBeenCalledWith('doc-1')
  })

  it('erro ao processar não trava o job pra sempre — propaga pro retry do BullMQ (attempts: 3 já configurado na fila)', async () => {
    vi.spyOn(service, 'processarDocumento').mockRejectedValue(new Error('PDF corrompido'))
    await expect(processDocumentReaderJob({ data: { receivedDocumentId: 'doc-2' } })).rejects.toThrow('PDF corrompido')
  })
})
