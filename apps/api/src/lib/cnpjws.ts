import axios from 'axios'

export interface CnpjLookupResult {
  razaoSocial: string
  nomeFantasia: string | null
  cep: string | null
  estado: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
}

interface CnpjWsEstabelecimento {
  cep: string | null
  bairro: string | null
  tipo_logradouro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  nome_fantasia: string | null
  estado: { sigla: string } | null
  cidade: { nome: string } | null
}

interface CnpjWsResponse {
  razao_social: string
  estabelecimento: CnpjWsEstabelecimento
}

// API pública do CNPJ.ws — sem autenticação, limite de 3 requisições/minuto por IP.
// https://docs.cnpj.ws/referencia-de-api/api-publica/consultando-cnpj
export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')

  const response = await axios.get<CnpjWsResponse>(`https://publica.cnpj.ws/cnpj/${digits}`)
  const { razao_social, estabelecimento: e } = response.data

  const logradouro = [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ').trim() || null

  return {
    razaoSocial: razao_social,
    nomeFantasia: e.nome_fantasia,
    cep: e.cep,
    estado: e.estado?.sigla ?? null,
    cidade: e.cidade?.nome ?? null,
    bairro: e.bairro,
    logradouro,
    numero: e.numero,
    complemento: e.complemento,
  }
}
