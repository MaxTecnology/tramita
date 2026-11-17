// Appends the INSERT of every municipality (prisma/data/municipios-ibge.json) to a migration file.
//   node scripts/municipalities/build-migration.mjs prisma/migrations/<ts>_municipalities/migration.sql
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = process.argv[2]
if (!target) throw new Error('Informe o migration.sql de destino')
const here = dirname(fileURLToPath(import.meta.url))
const list = JSON.parse(readFileSync(resolve(here, '../../prisma/data/municipios-ibge.json'), 'utf8'))

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
const rows = list.map((m) => `(${Number(m.ibgeCode)}, ${quote(m.name)}, ${quote(m.uf)})`)
const chunks = []
for (let i = 0; i < rows.length; i += 1000) chunks.push(rows.slice(i, i + 1000))
const sql = chunks.map((c) => `INSERT INTO "municipalities" ("ibgeCode", "name", "uf") VALUES\n${c.join(',\n')};\n`).join('\n')
appendFileSync(target, `\n-- Municipalities (IBGE, ${list.length})\n${sql}`)
console.log(`${list.length} municípios adicionados em ${target}`)
