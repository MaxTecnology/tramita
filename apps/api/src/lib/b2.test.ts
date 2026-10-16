import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  }
})

describe('deleteFile', () => {
  beforeEach(() => {
    sendMock.mockReset()
    vi.resetModules()
  })

  it('recusa apagar com chave vazia sem nunca chamar o S3 client — proteção contra apagar o bucket inteiro', async () => {
    const { deleteFile } = await import('./b2')
    await expect(deleteFile('')).rejects.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('só apaga versões cuja Key bate exatamente com a chave pedida, mesmo se a listagem por prefixo devolver outras', async () => {
    sendMock.mockImplementation((command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'ListObjectVersionsCommand') {
        return Promise.resolve({
          Versions: [
            { Key: 'document-reader/org-a/arquivo.pdf', VersionId: 'v1' },
            { Key: 'document-reader/org-b/outro-arquivo.pdf', VersionId: 'v2' }, // não deveria ser apagado
          ],
          DeleteMarkers: [],
        })
      }
      return Promise.resolve({})
    })

    const { deleteFile } = await import('./b2')
    await deleteFile('document-reader/org-a/arquivo.pdf')

    const deleteCall = sendMock.mock.calls.find(([c]) => c.constructor.name === 'DeleteObjectsCommand')
    expect(deleteCall).toBeDefined()
    const objects = deleteCall![0].input.Delete.Objects
    expect(objects).toEqual([{ Key: 'document-reader/org-a/arquivo.pdf', VersionId: 'v1' }])
  })
})
