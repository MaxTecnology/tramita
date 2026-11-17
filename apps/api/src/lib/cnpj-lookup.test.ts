import { vi, describe, it, expect, afterEach } from 'vitest'
import axios from 'axios'
import { lookupCnpj, CnpjNotFoundError, CnpjUnavailableError } from '@/lib/cnpj-lookup'

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1/11222333000181'
const CNPJ_WS = 'https://publica.cnpj.ws/cnpj/11222333000181'

const brasilApiBody = {
  razao_social: 'AutoHubs Tecnologia LTDA',
  nome_fantasia: 'AutoHubs',
  cep: '49000000',
  uf: 'SE',
  municipio: 'ARACAJU',
  codigo_municipio_ibge: 2800308,
  bairro: 'Centro',
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DAS FLORES',
  numero: '123',
  complemento: 'SALA 4',
}

const cnpjWsBody = {
  razao_social: 'AutoHubs Tecnologia LTDA',
  estabelecimento: {
    cep: '57000000', bairro: 'Centro', tipo_logradouro: 'Rua', logradouro: 'das Flores', numero: '123',
    complemento: null, nome_fantasia: null, estado: { sigla: 'AL' }, cidade: { nome: 'Maceió' },
  },
}

const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status } })
const timeout = () => Object.assign(new Error('timeout of 8000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' })

describe('lookupCnpj (BrasilAPI com CNPJ.ws de reserva)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the BrasilAPI: state, city and its IBGE code, 8 s timeout', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: brasilApiBody })
    const result = await lookupCnpj('11.222.333/0001-81')
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(BRASIL_API, { timeout: 8000 })
    expect(result).toEqual({
      razaoSocial: 'AutoHubs Tecnologia LTDA', nomeFantasia: 'AutoHubs', cep: '49000000',
      estado: 'SE', cidade: 'ARACAJU', ibgeCityCode: 2800308,
      bairro: 'Centro', logradouro: 'RUA DAS FLORES', numero: '123', complemento: 'SALA 4',
    })
  })

  it.each([
    ['500', httpError(500)], ['504', httpError(504)], ['429', httpError(429)], ['timeout', timeout()],
  ])('BrasilAPI %s → falls back to the CNPJ.ws (no IBGE code there)', async (_label, failure) => {
    const get = vi.spyOn(axios, 'get').mockRejectedValueOnce(failure).mockResolvedValueOnce({ data: cnpjWsBody })
    const result = await lookupCnpj('11222333000181')
    expect(get).toHaveBeenNthCalledWith(2, CNPJ_WS, { timeout: 8000 })
    expect(result).toMatchObject({ estado: 'AL', cidade: 'Maceió', ibgeCityCode: null, logradouro: 'Rua das Flores' })
  })

  it('BrasilAPI 404 → not found, without asking the reserve', async () => {
    const get = vi.spyOn(axios, 'get').mockRejectedValue(httpError(404))
    await expect(lookupCnpj('11222333000181')).rejects.toBeInstanceOf(CnpjNotFoundError)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('both services down → unavailable', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(httpError(502)).mockRejectedValueOnce(timeout())
    await expect(lookupCnpj('11222333000181')).rejects.toBeInstanceOf(CnpjUnavailableError)
  })

  it('reserve says 404 after the BrasilAPI was down → not found', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(httpError(500)).mockRejectedValueOnce(httpError(404))
    await expect(lookupCnpj('11222333000181')).rejects.toBeInstanceOf(CnpjNotFoundError)
  })
})
