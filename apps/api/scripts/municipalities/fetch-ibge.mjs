// One-off: downloads Brazil's municipalities from the IBGE API and writes
// prisma/data/municipios-ibge.json ([{ ibgeCode, name, uf }], sorted by code). The JSON is committed;
// the app never calls IBGE at runtime. Re-run only to refresh the list (new municipality).
//   node scripts/municipalities/fetch-ibge.mjs
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../prisma/data/municipios-ibge.json')

const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios')
if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`)
const raw = await res.json()

// The UF lives under microrregiao; a few records only carry it under regiao-imediata
const ufOf = (m) => m.microrregiao?.mesorregiao?.UF?.sigla ?? m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla
const list = raw
  .map((m) => ({ ibgeCode: Number(m.id), name: m.nome, uf: ufOf(m) }))
  .sort((a, b) => a.ibgeCode - b.ibgeCode)

const missing = list.filter((m) => !m.uf || !Number.isInteger(m.ibgeCode))
if (missing.length) throw new Error(`Municípios sem UF/código: ${JSON.stringify(missing)}`)

writeFileSync(out, `${JSON.stringify(list, null, 0).replace(/\},\{/g, '},\n{')}\n`)
console.log(`${list.length} municípios gravados em ${out}`)
