import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

export async function seedDocumentModels(prisma: PrismaClient) {
  const obrigacoesPorCode = new Map<string, string>()
  for (const o of OBRIGACOES) {
    const existente = await prisma.taxObligationType.findFirst({
      where: { organizationId: null, code: o.code },
    })
    const criada = existente ?? (await prisma.taxObligationType.create({
      data: { code: o.code, name: o.name, organizationId: null },
    }))
    obrigacoesPorCode.set(o.code, criada.id)
  }

  for (const m of MODELOS) {
    const definicao = JSON.parse(
      readFileSync(join(import.meta.dirname, 'seed-data/document-models', m.arquivo), 'utf-8'),
    )
    const taxObligationTypeId = obrigacoesPorCode.get(m.obrigacaoPrincipal)!
    const existente = await prisma.documentModel.findFirst({
      where: { organizationId: null, name: definicao.nome },
    })
    if (existente) continue // seed idempotente — não duplica em reruns
    await prisma.documentModel.create({
      data: { organizationId: null, taxObligationTypeId, name: definicao.nome, definicao },
    })
  }

  console.log(`Seed: ${OBRIGACOES.length} obrigações fiscais + ${MODELOS.length} modelos globais`)
}
