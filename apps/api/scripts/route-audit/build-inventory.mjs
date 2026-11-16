// Builds docs/api-inventory.md from the probe (out/probe.json), the web calls (apps/web/src) and the
// API tests (apps/api/src/**/*.test.ts). Run through `pnpm --filter api audit:routes`.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../../..')
const probe = JSON.parse(readFileSync(join(here, 'out/probe.json'), 'utf8'))
const ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT', 'MASTER']
const ROLE_LABEL = { ANON: 'Anônimo', ORG_ADMIN: 'Admin', ORG_MANAGER: 'Gerente', ORG_MEMBER: 'Membro', CLIENT: 'Cliente', MASTER: 'Master' }

// Callers that are not the web app: kept explicit so "sem uso" means really unused
const EXTERNAL = {
  'POST /webhooks/asaas': 'Asaas (webhook)',
  'POST /auth/refresh': 'web (auth-refresh, fetch direto)',
  'GET /health': 'Docker/Traefik (healthcheck)',
}

function files(dir, keep) {
  const out = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (f === 'node_modules') continue
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (keep(p)) out.push(p)
    }
  }
  walk(dir)
  return out
}

const norm = (u) => u.split('?')[0].replace(/\$\{[^}]+\}/g, ':x').replace(/\/+$/, '') || '/'
const toRe = (u) => new RegExp('^' + (u.replace(/\/+$/, '') || '/').replace(/:[A-Za-z]+/g, '[^/]+') + '$')

// Web: typed calls (api.get('/x')) and any other path literal (EventSource, links, generic helpers)
const webFiles = files(join(root, 'apps/web/src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))
const webCalls = []
const webPaths = []
for (const f of webFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/(?:api|axios)\.(get|post|patch|put|delete)(?:<[^>]*>)?\(\s*([`'"])([^`'"]+)\2/g)) webCalls.push({ method: m[1].toUpperCase(), url: norm(m[3]) })
  for (const m of src.matchAll(/[`'"](\/[a-z][a-z0-9\-/${}.:?=&_]*)[`'"]/gi)) webPaths.push(norm(m[1]))
}

// API tests: every url: '...' given to app.inject
const testFiles = files(join(root, 'apps/api/src'), (p) => /\.test\.ts$/.test(p))
const testCalls = []
for (const f of testFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/method:\s*'([A-Z]+)'[^}]*?url:\s*([`'"])([^`'"]+)\2/gs)) testCalls.push({ method: m[1], url: norm(m[3]) })
  for (const m of src.matchAll(/url:\s*([`'"])([^`'"]+)\1[^}]*?method:\s*'([A-Z]+)'/gs)) testCalls.push({ method: m[3], url: norm(m[2]) })
}

const blocked = (s) => s === 401 || s === 403
const rows = Object.entries(probe).map(([key, status]) => {
  const [method, url] = key.split(' ')
  const re = toRe(url)
  const direct = webCalls.some((c) => c.method === method && re.test(c.url))
  const cited = !direct && webPaths.some((p) => re.test(p))
  const external = EXTERNAL[key]
  const usedBy = external ?? (direct ? 'web' : cited ? 'web (indireto)' : '—')
  const tested = testCalls.some((c) => c.method === method && re.test(c.url))
  const who = blocked(status.ANON) ? ROLES.filter((r) => !blocked(status[r])) : ['ANON']
  return { method, url, status, usedBy, tested, who, module: url.split('/')[1] || '/' }
})

const whoLabel = (r) => r.who.includes('ANON') ? '**público**' : r.who.length === 0 ? 'token próprio (ticket/webhook)' : r.who.map((w) => ROLE_LABEL[w]).join(', ')
const byModule = new Map()
for (const r of rows.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))) {
  if (!byModule.has(r.module)) byModule.set(r.module, [])
  byModule.get(r.module).push(r)
}

const unused = rows.filter((r) => r.usedBy === '—')
const untested = rows.filter((r) => !r.tested)
const publicRoutes = rows.filter((r) => r.who.includes('ANON'))
const clientOutsidePortal = rows.filter((r) => r.who.includes('CLIENT') && !/^\/(portal|auth|notifications|stream)/.test(r.url))

const lines = []
lines.push('# Inventário da API', '')
lines.push('> Gerado por `pnpm --filter api audit:routes` (apps/api/scripts/route-audit). Não editar à mão: rode de novo.', '')
lines.push('"Quem passa" vem de chamar cada rota sem token e com um token de cada papel, no banco de teste (passa = não recebe 401/403). "Usada por" cruza com as chamadas do web; "Teste de rota" indica se algum teste da API chama a rota por HTTP (a regra pode ter teste só no service).', '')
lines.push('## Resumo', '')
lines.push(`- Rotas: **${rows.length}**`)
lines.push(`- Públicas (sem login): **${publicRoutes.length}** — ${publicRoutes.map((r) => `\`${r.method} ${r.url}\``).join(', ')}`)
lines.push(`- Sem uso no web nem chamador externo conhecido: **${unused.length}**`)
lines.push(`- Sem teste de rota: **${untested.length}**`)
lines.push(`- Cliente (portal) passa fora de /portal: **${clientOutsidePortal.length}** (rotas compartilhadas — o escopo dentro delas é revisado na auditoria de segurança)`, '')
lines.push('## Sem uso', '')
lines.push('| Método | Rota | Quem passa | Teste de rota |', '|---|---|---|---|')
for (const r of unused) lines.push(`| ${r.method} | \`${r.url}\` | ${whoLabel(r)} | ${r.tested ? 'sim' : 'não'} |`)
lines.push('')
lines.push('## Cliente fora de /portal', '')
lines.push('| Método | Rota | Quem passa |', '|---|---|---|')
for (const r of clientOutsidePortal) lines.push(`| ${r.method} | \`${r.url}\` | ${whoLabel(r)} |`)
lines.push('')
lines.push('## Todas as rotas por módulo', '')
for (const [mod, list] of byModule) {
  lines.push(`### /${mod === '/' ? '' : mod}`, '')
  lines.push('| Método | Rota | Quem passa | Usada por | Teste de rota |', '|---|---|---|---|---|')
  for (const r of list) lines.push(`| ${r.method} | \`${r.url}\` | ${whoLabel(r)} | ${r.usedBy} | ${r.tested ? 'sim' : '**não**'} |`)
  lines.push('')
}
writeFileSync(join(root, 'docs/api-inventory.md'), lines.join('\n'))
console.log(`docs/api-inventory.md: ${rows.length} rotas, ${unused.length} sem uso, ${untested.length} sem teste`)
