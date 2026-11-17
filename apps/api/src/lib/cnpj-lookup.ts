import axios from 'axios'

// Company data by CNPJ for the client form. BrasilAPI first (fast, brings the city's IBGE code);
// the public CNPJ.ws (3 requests/min per IP, unstable) only when the BrasilAPI is down. HTTP only:
// the caller matches the city against the municipalities table.

export interface CnpjLookupResult {
  razaoSocial: string
  nomeFantasia: string | null
  cep: string | null
  estado: string | null
  cidade: string | null
  ibgeCityCode: number | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
}

export class CnpjNotFoundError extends Error {}
export class CnpjUnavailableError extends Error {}

const TIMEOUT_MS = 8000

interface BrasilApiResponse {
  razao_social: string
  nome_fantasia: string | null
  cep: string | null
  uf: string | null
  municipio: string | null
  codigo_municipio_ibge: number | null
  bairro: string | null
  descricao_tipo_de_logradouro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
}

interface CnpjWsResponse {
  razao_social: string
  estabelecimento: {
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
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
const street = (type: string | null, name: string | null) => [type, name].filter(Boolean).join(' ').trim() || null

function fromBrasilApi(d: BrasilApiResponse): CnpjLookupResult {
  return {
    razaoSocial: d.razao_social,
    nomeFantasia: text(d.nome_fantasia),
    cep: text(d.cep),
    estado: text(d.uf),
    cidade: text(d.municipio),
    ibgeCityCode: typeof d.codigo_municipio_ibge === 'number' ? d.codigo_municipio_ibge : null,
    bairro: text(d.bairro),
    logradouro: street(d.descricao_tipo_de_logradouro, d.logradouro),
    numero: text(d.numero),
    complemento: text(d.complemento),
  }
}

function fromCnpjWs(d: CnpjWsResponse): CnpjLookupResult {
  const e = d.estabelecimento
  return {
    razaoSocial: d.razao_social,
    nomeFantasia: text(e.nome_fantasia),
    cep: text(e.cep),
    estado: e.estado?.sigla ?? null,
    cidade: e.cidade?.nome ?? null,
    ibgeCityCode: null,
    bairro: text(e.bairro),
    logradouro: street(e.tipo_logradouro, e.logradouro),
    numero: text(e.numero),
    complemento: text(e.complemento),
  }
}

const isNotFound = (err: unknown) => axios.isAxiosError(err) && err.response?.status === 404

export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')
  try {
    const res = await axios.get<BrasilApiResponse>(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { timeout: TIMEOUT_MS })
    return fromBrasilApi(res.data)
  } catch (err) {
    // Not found is an answer; anything else (5xx, 429, timeout, odd payload) tries the reserve
    if (isNotFound(err)) throw new CnpjNotFoundError()
  }
  try {
    const res = await axios.get<CnpjWsResponse>(`https://publica.cnpj.ws/cnpj/${digits}`, { timeout: TIMEOUT_MS })
    return fromCnpjWs(res.data)
  } catch (err) {
    if (isNotFound(err)) throw new CnpjNotFoundError()
    throw new CnpjUnavailableError()
  }
}
