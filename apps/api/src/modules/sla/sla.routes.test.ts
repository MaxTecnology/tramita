import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import * as b2Module from '@/lib/b2'

beforeEach(() => {
  vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://signed.example/sound.mp3')
})

describe('GET /sla/config', () => {
  it('retorna defaults quando a org nunca configurou', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({ method: 'GET', url: '/sla/config', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.slaTargetWarningDays).toBe(3)
    expect(body.slaDueCriticalDays).toBe(1)
    expect(body.hasCustomSound).toBe(false)
  })

  it('é acessível por ORG_MEMBER (não exige ORG_ADMIN)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const res = await app.inject({ method: 'GET', url: '/sla/config', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET/PATCH /sla/preferences', () => {
  it('cria com defaults na primeira leitura e persiste updates', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const getRes = await app.inject({ method: 'GET', url: '/sla/preferences', headers: { authorization: auth } })
    expect(getRes.statusCode).toBe(200)
    expect(JSON.parse(getRes.body).targetWarningSound).toBe('SOFT_PING')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/sla/preferences',
      headers: { authorization: auth },
      payload: { targetWarningSound: 'MUTE', dueCriticalVolume: 90 },
    })
    expect(patchRes.statusCode).toBe(200)
    const body = JSON.parse(patchRes.body)
    expect(body.targetWarningSound).toBe('MUTE')
    expect(body.dueCriticalVolume).toBe(90)
  })

  it('não quebra com dois GETs concorrentes na primeira leitura (race condition de criação)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'GET', url: '/sla/preferences', headers: { authorization: auth } }),
      app.inject({ method: 'GET', url: '/sla/preferences', headers: { authorization: auth } }),
    ])

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
  })

  it('PATCH concorrente na primeira escrita não perde os dados pedidos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: '/sla/preferences',
        headers: { authorization: auth },
        payload: { targetWarningSound: 'CHIME' },
      }),
      app.inject({
        method: 'PATCH',
        url: '/sla/preferences',
        headers: { authorization: auth },
        payload: { dueCriticalVolume: 99 },
      }),
    ])

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)

    const final = await app.inject({ method: 'GET', url: '/sla/preferences', headers: { authorization: auth } })
    const body = JSON.parse(final.body)
    // Cada PATCH concorrente aplicou seu próprio campo, independente de qual "venceu" a criação
    // da linha — nenhum dos dois pode ter sido silenciosamente descartado.
    expect(body.targetWarningSound).toBe('CHIME')
    expect(body.dueCriticalVolume).toBe(99)
  })
})
