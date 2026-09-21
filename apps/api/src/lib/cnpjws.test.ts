import { vi, describe, it, expect, afterEach } from 'vitest'
import axios from 'axios'
import { lookupCnpj } from '@/lib/cnpjws'

describe('lookupCnpj', () => {
  afterEach(() => vi.restoreAllMocks())

  it('consulta a API pública do CNPJ.ws e mapeia os campos de endereço', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        razao_social: 'AutoHubs Tecnologia LTDA',
        estabelecimento: {
          cep: '57000-000',
          bairro: 'Centro',
          tipo_logradouro: 'RUA',
          logradouro: 'das Flores',
          numero: '123',
          complemento: 'Sala 4',
          nome_fantasia: 'AutoHubs',
          estado: { sigla: 'AL' },
          cidade: { nome: 'Maceió' },
        },
      },
    })

    const result = await lookupCnpj('11.222.333/0001-81')

    expect(axios.get).toHaveBeenCalledWith('https://publica.cnpj.ws/cnpj/11222333000181')
    expect(result).toEqual({
      razaoSocial: 'AutoHubs Tecnologia LTDA',
      nomeFantasia: 'AutoHubs',
      cep: '57000-000',
      estado: 'AL',
      cidade: 'Maceió',
      bairro: 'Centro',
      logradouro: 'RUA das Flores',
      numero: '123',
      complemento: 'Sala 4',
    })
  })

  it('propaga o erro quando a API rejeita (ex: 429 rate limit)', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('Request failed with status code 429'))
    await expect(lookupCnpj('11222333000181')).rejects.toThrow('Request failed with status code 429')
  })
})
