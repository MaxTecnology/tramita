import { describe, expect, it } from 'vitest'
import { executarIsolado } from './isolated-worker'

const TSX_EXEC_ARGV = { execArgv: ['--import', 'tsx'] }

function fixture(nome: string): URL {
  return new URL(`./__fixtures__/${nome}.fixture.ts`, import.meta.url)
}

describe('executarIsolado', () => {
  it('resolve com o resultado postado pelo worker', async () => {
    const resultado = await executarIsolado<{ veio: boolean }>(
      fixture('isolated-worker-ok'),
      { veio: true },
      2000,
      TSX_EXEC_ARGV,
    )
    expect(resultado).toEqual({ veio: true })
  })

  it('rejeita com a mensagem de erro reportada pelo worker', async () => {
    await expect(
      executarIsolado(fixture('isolated-worker-erro'), null, 2000, TSX_EXEC_ARGV),
    ).rejects.toThrow('falha proposital do fixture')
  })

  it('interrompe um laço síncrono travado ao estourar o timeout, sem travar a thread principal', async () => {
    let ticou = false
    const ticker = setInterval(() => { ticou = true }, 20)

    const inicio = Date.now()
    await expect(
      executarIsolado(fixture('isolated-worker-loop'), null, 300, TSX_EXEC_ARGV),
    ).rejects.toThrow('Timeout de 300ms')
    const duracao = Date.now() - inicio

    clearInterval(ticker)
    expect(duracao).toBeLessThan(1000)
    expect(ticou).toBe(true)
  })

  it('rejeita quando o worker encerra inesperadamente sem postar mensagem', async () => {
    await expect(
      executarIsolado(fixture('isolated-worker-crash'), null, 2000, TSX_EXEC_ARGV),
    ).rejects.toThrow('Worker encerrou inesperadamente')
  })
})
