// Writes the API documentation files: docs/api/openapi.json (OpenAPI 3.1) and docs/api/llms.md
// (the same content as Markdown, for AI agents). Who can call each route comes from the route
// audit probe; run `pnpm --filter api audit:routes` first so it is current.
//   pnpm --filter api docs:api
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownFromOpenApi } from '@scalar/openapi-to-markdown'
import { buildApp } from '@/server'
import { withRoles, type Probe, type Spec } from '@/api-docs/roles'
import { ROUTE_DOCS } from '@/api-docs/catalog'

// The committed file must not depend on who generated it
const PUBLIC_API_URL = 'https://tramitaapi.autohubs.com.br'

const here = dirname(fileURLToPath(import.meta.url))
const probePath = resolve(here, '../route-audit/out/probe.json')
const outDir = resolve(here, '../../../../docs/api')

const app = buildApp()
await app.ready()
const spec = JSON.parse(JSON.stringify(app.swagger())) as Spec
await app.close()

if (!existsSync(probePath)) {
  console.error('probe.json não encontrado. Rode `pnpm --filter api audit:routes` antes de gerar a documentação.')
  process.exit(1)
}
const declared = Object.fromEntries(Object.entries(ROUTE_DOCS).flatMap(([key, entry]) => (entry.roles ? [[key, entry.roles]] : [])))
const { missing, ...withWho } = withRoles(spec, JSON.parse(readFileSync(probePath, 'utf8')) as Probe, declared)
if (missing.length) {
  console.error(`Rotas fora do probe (rode audit:routes de novo): ${missing.join(', ')}`)
  process.exit(1)
}
const finalSpec: Spec = { ...withWho, servers: [{ url: PUBLIC_API_URL, description: 'Produção' }, { url: 'http://localhost:3000', description: 'Local' }] }

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'openapi.json'), `${JSON.stringify(finalSpec, null, 2)}\n`)
writeFileSync(resolve(outDir, 'llms.md'), await createMarkdownFromOpenApi(finalSpec))
console.log(`Documentação da API gerada em ${outDir}`)
process.exit(0)
