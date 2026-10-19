import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { PrismaClient } from '@prisma/client'

const OBRIGACOES = [
  { code: 'IRPJ', name: 'IRPJ' },
  { code: 'CSLL', name: 'CSLL' },
  { code: 'DAS', name: 'DAS — Simples Nacional' },
  { code: 'PGDAS-D', name: 'PGDAS-D — Declaração do Simples Nacional' },
]

const MODELOS = [
  { arquivo: 'darf-rfb.json', obrigacaoPrincipal: 'IRPJ' },
  { arquivo: 'das-guia.json', obrigacaoPrincipal: 'DAS' },
  { arquivo: 'pgdas-recibo.json', obrigacaoPrincipal: 'PGDAS-D' },
  { arquivo: 'pgdas-declaracao.json', obrigacaoPrincipal: 'PGDAS-D' },
]

// Arredonda todo número pra 9 casas decimais, recursivamente — muito mais precisão do que
// qualquer coordenada normalizada (0..1) de PDF precisa, só o suficiente pra absorver o drift de
// round-trip do Postgres JSONB sem mascarar uma mudança real de layout.
function normalizarNumeros(valor: unknown): unknown {
  if (typeof valor === 'number') return Math.round(valor * 1e9) / 1e9
  if (Array.isArray(valor)) return valor.map(normalizarNumeros)
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, normalizarNumeros(v)]))
  }
  return valor
}

export async function seedDocumentModels(prisma: PrismaClient) {
  const obrigacoesPorCode = new Map<string, string>()
  for (const o of OBRIGACOES) {
    const existente = await prisma.obligationType.findFirst({
      where: { organizationId: null, code: o.code },
    })
    const criada = existente ?? (await prisma.obligationType.create({
      data: { code: o.code, name: o.name, organizationId: null },
    }))
    obrigacoesPorCode.set(o.code, criada.id)
  }

  for (const m of MODELOS) {
    const definicao = JSON.parse(
      readFileSync(join(import.meta.dirname, 'seed-data/document-models', m.arquivo), 'utf-8'),
    )
    const obligationTypeId = obrigacoesPorCode.get(m.obrigacaoPrincipal)!
    // Casa pelo "id" (slug) de dentro do JSON, não pelo `name` — `name` é só rótulo de UI, pode
    // mudar sem o modelo virar outro; o slug (ex. "darf-rfb") é o que identifica de fato qual
    // arquivo originou aquele registro. Sem isso, editar o JSON de um modelo global (ex. o ajuste
    // multi-filial do PGDAS-D) nunca atualizava o registro existente nem criava uma nova versão —
    // o seed via `continue` achava o registro pelo nome (inalterado) e nunca olhava o conteúdo.
    const existente = await prisma.documentModel.findFirst({
      where: { organizationId: null, definicao: { path: ['id'], equals: definicao.id } },
    })
    if (!existente) {
      await prisma.documentModel.create({
        data: { organizationId: null, obligationTypeId, name: definicao.nome, definicao },
      })
      continue
    }
    // Deep equal depois de normalizar números (não JSON.stringify cru, nem isDeepStrictEqual
    // direto) — o Postgres JSONB não preserva a ordem das chaves E arredonda floats de altíssima
    // precisão de um jeito levemente diferente no round-trip (ex.: 0.2726128266033254 no JSON
    // de origem volta como 0.27261282660332536 depois de gravado) — sem normalizar, todo rerun
    // sem mudança nenhuma geraria um falso-positivo de "mudou" e bumparia version à toa.
    if (isDeepStrictEqual(normalizarNumeros(existente.definicao), normalizarNumeros(definicao))) continue
    await prisma.documentModel.update({
      where: { id: existente.id },
      data: { name: definicao.nome, definicao, version: { increment: 1 } },
    })
  }

  console.log(`Seed: ${OBRIGACOES.length} obrigações + ${MODELOS.length} modelos globais`)
}
