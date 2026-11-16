// Route audit probe: lists every registered route and calls it anonymously and with one token per
// role, recording the status code. Runs on the TEST database (vitest.audit.config.ts) and writes
// scripts/route-audit/out/probe.json, read by build-inventory.mjs. Never runs in the normal suite.
//
//   pnpm --filter api audit:routes
import { it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from '../../src/server'
import * as queue from '../../src/lib/queue'
import * as cnpjws from '../../src/lib/cnpjws'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClientUser, createMasterUser, getAuthHeader,
} from '../../src/test/helpers'

// A well-formed id that matches nothing: the request reaches the handler only if auth lets it through
const FAKE_ID = 'cm0000000000000000000000a'
const OUT_DIR = join(__dirname, 'out')

it('probes every route by role', async () => {
  // No outside effects: notifications are not queued and the CNPJ lookup never leaves the machine
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
  vi.spyOn(cnpjws, 'lookupCnpj').mockRejectedValue(new Error('route audit'))

  const probe = buildApp()
  const routes: { method: string; url: string }[] = []
  probe.addHook('onRoute', (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) {
      if (method !== 'HEAD' && method !== 'OPTIONS') routes.push({ method, url: r.url })
    }
  })
  await probe.ready()

  const org = await createTestOrg((await createTestPlan()).id)
  const tokens: [string, string][] = [['ANON', '']]
  for (const role of ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const) {
    const user = await createTestUser(org.id, { role })
    tokens.push([role, await getAuthHeader(user.email, 'Test@1234')])
  }
  const { clientUser, password } = await createTestClientUser(org.id)
  tokens.push(['CLIENT', await getAuthHeader(clientUser.email, password)])
  const master = await createMasterUser()
  tokens.push(['MASTER', await getAuthHeader(master.user.email, master.password)])

  const result: Record<string, Record<string, number>> = {}
  const unique = [...new Map(routes.map((r) => [`${r.method} ${r.url}`, r])).values()]
  for (const r of unique) {
    const url = r.url.replace(/:[A-Za-z]+/g, FAKE_ID)
    const row: Record<string, number> = {}
    for (const [who, auth] of tokens) {
      const res = await probe.inject({
        method: r.method as 'GET',
        url,
        headers: auth ? { authorization: auth } : {},
        ...(['POST', 'PATCH', 'PUT'].includes(r.method) ? { payload: {} } : {}),
      })
      row[who] = res.statusCode
    }
    result[`${r.method} ${r.url}`] = row
  }
  await probe.close()
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'probe.json'), JSON.stringify(result, null, 1))
}, 600_000)
