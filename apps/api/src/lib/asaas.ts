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
