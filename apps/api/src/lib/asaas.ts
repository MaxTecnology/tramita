import axios from 'axios'

const asaasHttp = axios.create({
  baseURL: process.env.ASAAS_BASE_URL ?? 'https://api.asaas.com/v3',
  headers: { access_token: process.env.ASAAS_API_KEY ?? '' },
})

export interface AsaasCustomer {
  id: string
  name: string
  email: string
}

export interface AsaasSubscription {
  id: string
  status: string
}

export async function createCustomer(data: {
  name: string
  email: string
  cpfCnpj?: string
}): Promise<AsaasCustomer> {
  const res = await asaasHttp.post<AsaasCustomer>('/customers', data)
  return res.data
}

export async function createSubscription(data: {
  customer: string
  billingType: 'BOLETO' | 'CREDIT_CARD' | 'PIX'
  value: number
  cycle: 'MONTHLY'
  description?: string
}): Promise<AsaasSubscription> {
  const res = await asaasHttp.post<AsaasSubscription>('/subscriptions', data)
  return res.data
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await asaasHttp.delete(`/subscriptions/${subscriptionId}`)
}

// Reasons the billing gave for refusing a call ("code: description"), for logs and the user message
export function asaasErrorReasons(err: unknown): string[] {
  if (!axios.isAxiosError(err)) return []
  const data: unknown = err.response?.data
  if (!data || typeof data !== 'object' || !('errors' in data) || !Array.isArray(data.errors)) return []
  return data.errors
    .filter((e): e is { code?: unknown; description?: unknown } => !!e && typeof e === 'object')
    .map((e) => `${String(e.code ?? 'erro')}: ${String(e.description ?? '')}`)
}
