import axios from 'axios'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { redis } from '@/lib/redis'

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

// No redirects (fixed hosts) and a small body: a company record is a few KB
const HTTP_OPTIONS = { timeout: 8000, maxRedirects: 0, maxContentLength: 200_000 }

// Outside answers are validated like any input: a shape we do not expect is not trusted
const text = z.string().max(500).nullish()
const brasilApiSchema = z.object({
  razao_social: z.string().min(1).max(500),
  nome_fantasia: text,
  cep: text,
  uf: text,
  municipio: text,
  codigo_municipio_ibge: z.number().int().nullish(),
  bairro: text,
  descricao_tipo_de_logradouro: text,
  logradouro: text,
  numero: text,
  complemento: text,
})
const cnpjWsSchema = z.object({
  razao_social: z.string().min(1).max(500),
  estabelecimento: z.object({
    cep: text,
    bairro: text,
    tipo_logradouro: text,
    logradouro: text,
    numero: text,
    complemento: text,
    nome_fantasia: text,
    estado: z.object({ sigla: z.string().max(2) }).nullish(),
    cidade: z.object({ nome: z.string().max(200) }).nullish(),
  }),
})
type BrasilApiResponse = z.infer<typeof brasilApiSchema>
type CnpjWsResponse = z.infer<typeof cnpjWsSchema>

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)
const street = (type: string | null | undefined, name: string | null | undefined) => [type, name].filter(Boolean).join(' ').trim() || null

function fromBrasilApi(d: BrasilApiResponse): CnpjLookupResult {
  return {
    razaoSocial: d.razao_social,
    nomeFantasia: clean(d.nome_fantasia),
    cep: clean(d.cep),
    estado: clean(d.uf),
    cidade: clean(d.municipio),
    ibgeCityCode: d.codigo_municipio_ibge ?? null,
    bairro: clean(d.bairro),
    logradouro: street(d.descricao_tipo_de_logradouro, d.logradouro),
    numero: clean(d.numero),
    complemento: clean(d.complemento),
  }
}

function fromCnpjWs(d: CnpjWsResponse): CnpjLookupResult {
  const e = d.estabelecimento
  return {
    razaoSocial: d.razao_social,
    nomeFantasia: clean(e.nome_fantasia),
    cep: clean(e.cep),
    estado: e.estado?.sigla ?? null,
    cidade: e.cidade?.nome ?? null,
    ibgeCityCode: null,
    bairro: clean(e.bairro),
    logradouro: street(e.tipo_logradouro, e.logradouro),
    numero: clean(e.numero),
    complemento: clean(e.complemento),
  }
}

const isNotFound = (err: unknown) => axios.isAxiosError(err) && err.response?.status === 404
// What went wrong, for the log (never the CNPJ)
const reason = (err: unknown) => (axios.isAxiosError(err) ? err.response?.status ?? err.code ?? 'network' : 'invalid payload')

// The CNPJ.ws allows 3 requests a minute per IP (the server's, shared by every office): after a 429
// it is left alone for a minute instead of being hammered. Redis down → no pause, asked as usual.
const CNPJ_WS_PAUSE_KEY = 'cnpj-lookup:cnpjws-paused'
const CNPJ_WS_PAUSE_SECONDS = 60

async function cnpjWsPaused(): Promise<boolean> {
  try {
    return (await redis.get(CNPJ_WS_PAUSE_KEY)) !== null
  } catch {
    return false
  }
}

async function pauseCnpjWs(): Promise<void> {
  try {
    await redis.set(CNPJ_WS_PAUSE_KEY, '1', 'EX', CNPJ_WS_PAUSE_SECONDS)
  } catch {
    // Without Redis there is no shared pause; the per-person route limit still applies
  }
}

export async function lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '')
  let primaryFailure: unknown
  try {
    const res = await axios.get<unknown>(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, HTTP_OPTIONS)
    return fromBrasilApi(brasilApiSchema.parse(res.data))
  } catch (err) {
    // Not found is an answer; anything else (5xx, 429, timeout, odd payload) tries the reserve
    if (isNotFound(err)) throw new CnpjNotFoundError()
    primaryFailure = err
  }
  if (await cnpjWsPaused()) {
    // Expected while paused (the 429 that started it was already logged as warn)
    logger.info({ brasilApi: reason(primaryFailure), cnpjWs: 'paused' }, 'Consulta de CNPJ: reserva em pausa')
    throw new CnpjUnavailableError()
  }
  try {
    const res = await axios.get<unknown>(`https://publica.cnpj.ws/cnpj/${digits}`, HTTP_OPTIONS)
    return fromCnpjWs(cnpjWsSchema.parse(res.data))
  } catch (err) {
    if (isNotFound(err)) throw new CnpjNotFoundError()
    if (axios.isAxiosError(err) && err.response?.status === 429) await pauseCnpjWs()
    logger.warn({ brasilApi: reason(primaryFailure), cnpjWs: reason(err) }, 'Consulta de CNPJ indisponível nos dois serviços')
    throw new CnpjUnavailableError()
  }
}
