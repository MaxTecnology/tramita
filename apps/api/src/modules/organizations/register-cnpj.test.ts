import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import * as asaas from '@/lib/asaas'
import { createTestPlan, generateValidCnpj } from '@/test/helpers'

beforeEach(() => {
  vi.spyOn(asaas, 'createCustomer').mockResolvedValue({ id: 'cus_1', name: 'X', email: 'x@x.com' })
  vi.spyOn(asaas, 'createSubscription').mockResolvedValue({ id: 'sub_1', status: 'ACTIVE' })
})
afterEach(() => vi.restoreAllMocks())

const body = (planId: string, extra: object = {}) => ({
  name: 'G2A Soluções Contábeis', email: `g2a-${Date.now()}-${Math.random()}@test.com`, adminName: 'Admin', adminPassword: 'Senha@123', planId, ...extra,
})
const register = (payload: object) => app.inject({ method: 'POST', url: '/organizations/register', payload })

describe('cadastro do escritório — CNPJ e cobrança', () => {
  it('"trial" without CNPJ is refused like any plan (there is no public trial)', async () => {
    const res = await register(body('trial'))
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).message).toBe('Informe o CNPJ do escritório')
  })

  it('a paid plan needs a valid CNPJ (the billing requires it)', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const none = await register(body(plan.id))
    expect(none.statusCode).toBe(400)
    expect(JSON.parse(none.body).message).toBe('Informe o CNPJ do escritório')
    const bad = await register(body(plan.id, { cnpj: '11.111.111/1111-11' }))
    expect(JSON.parse(bad.body).message).toBe('CNPJ inválido')
    expect(asaas.createCustomer).not.toHaveBeenCalled()
  })

  it('stores the CNPJ as digits and sends it to the billing', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const cnpj = generateValidCnpj(7)
    const masked = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    const res = await register(body(plan.id, { cnpj: masked }))
    expect(res.statusCode).toBe(201)
    expect(asaas.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ cpfCnpj: cnpj }))
    expect((await prisma.organization.findFirstOrThrow({ where: { name: 'G2A Soluções Contábeis' } })).cnpj).toBe(cnpj)
  })

  it('never returns the admin password hash', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const res = await register(body(plan.id, { cnpj: generateValidCnpj(9) }))
    expect(res.statusCode).toBe(201)
    expect(res.body).not.toContain('passwordHash')
    expect(JSON.parse(res.body).user).toEqual({ id: expect.any(String), name: 'Admin', email: expect.any(String), role: 'ORG_ADMIN' })
  })

  it('a billing refusal is logged with its reason and shown to the person', async () => {
    const plan = await createTestPlan({ name: 'Pro' })
    const refusal = new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400, statusText: 'Bad Request', headers: {}, config: { headers: new AxiosHeaders() },
      data: { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] },
    })
    vi.spyOn(asaas, 'createCustomer').mockRejectedValue(refusal)
    const log = vi.spyOn(logger, 'error')
    const res = await register(body(plan.id, { cnpj: generateValidCnpj(8) }))
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).message).toBe('Erro ao integrar com sistema de cobrança: O CPF/CNPJ informado é inválido.')
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ asaasErrors: ['invalid_cpfCnpj: O CPF/CNPJ informado é inválido.'] }), expect.any(String))
    expect(await prisma.organization.count({ where: { name: 'G2A Soluções Contábeis' } })).toBe(0)
  })
})
