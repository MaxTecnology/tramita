import { describe, it, expect } from 'vitest'
import { NotificationEvent } from '@prisma/client'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { DEFAULT_TEMPLATES } from '@/lib/default-templates'
import { EVENT_VARIABLES, PREVIEW_VARS } from '@/lib/template'

const usedIn = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])

describe('variáveis de cada aviso', () => {
  it('every event lists what it fills, and the default texts only use what is filled', () => {
    for (const event of Object.values(NotificationEvent)) {
      const available = EVENT_VARIABLES[event]
      expect(available, event).toBeDefined()
      for (const channel of ['WHATSAPP', 'EMAIL'] as const) {
        const t = DEFAULT_TEMPLATES[event][channel]
        for (const v of usedIn(`${t.subject ?? ''} ${t.body}`)) expect(available, `${event}/${channel} usa {{${v}}}`).toContain(v)
      }
    }
  })

  it('every listed variable has an example, so the preview never shows a hole', () => {
    for (const event of Object.values(NotificationEvent)) {
      for (const v of EVENT_VARIABLES[event]) expect(PREVIEW_VARS[v], `${event}: {{${v}}} sem exemplo`).toBeTruthy()
    }
  })

  it('the template screen gets the variables of the notice it opened', async () => {
    const org = await createTestOrg((await createTestPlan()).id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const res = await app.inject({ method: 'GET', url: '/notifications/templates/SLA_DIGEST/EMAIL', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    const { variables } = res.json() as { variables: string[] }
    expect(variables).toEqual(expect.arrayContaining(['taskCount', 'criticalCount', 'taskListText', 'portalUrl']))
    expect(variables).not.toContain('fromColumn')
  })
})
