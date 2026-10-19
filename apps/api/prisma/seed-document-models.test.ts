// apps/api/prisma/seed-document-models.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { seedDocumentModels } from './seed-document-models'

// prisma/ fica fora do `include` do tsconfig (só src/**/*) — sem alias @/, mesmo padrão que
// seed.ts já usa (PrismaClient próprio em vez de importar o singleton de src/lib/prisma).
const prisma = new PrismaClient()

describe('seedDocumentModels', () => {
  it('cria os 4 modelos globais na primeira execução', async () => {
    await seedDocumentModels(prisma)

    const modelos = await prisma.documentModel.findMany({ where: { organizationId: null } })
    expect(modelos).toHaveLength(4)
    expect(modelos.every((m) => m.version === 1)).toBe(true)
  })

  it('não duplica ao rodar duas vezes seguidas sem mudança nos JSONs', async () => {
    await seedDocumentModels(prisma)
    await seedDocumentModels(prisma)

    const modelos = await prisma.documentModel.findMany({ where: { organizationId: null } })
    expect(modelos).toHaveLength(4)
    expect(modelos.every((m) => m.version === 1)).toBe(true)
  })

  it('atualiza o registro existente (mesmo id de slug) e incrementa version quando o conteúdo do JSON muda, sem duplicar', async () => {
    await seedDocumentModels(prisma)
    const antes = await prisma.documentModel.findFirst({ where: { organizationId: null, name: { contains: 'DARF' } } })
    expect(antes?.version).toBe(1)

    // Mesmo slug "darf-rfb" (o motor só identifica o modelo por esse id interno — nunca pelo
    // `nome`, que é só rótulo pra UI), zona de "cnpj" com coordenadas diferentes — simula o ajuste
    // multi-filial do PGDAS-D que o tech-debt original citava como motivador. Mutação real do
    // arquivo em disco (não mock) — node:fs é ESM nativo, `vi.spyOn` não consegue sobrescrever um
    // export congelado do módulo embutido ("Cannot redefine property: readFileSync").
    const caminhoJson = join(import.meta.dirname, 'seed-data/document-models/darf-rfb.json')
    const conteudoOriginal = readFileSync(caminhoJson, 'utf-8')
    const json = JSON.parse(conteudoOriginal)
    json.zonas = json.zonas.map((z: { campo: string; x: number }) => (z.campo === 'cnpj' ? { ...z, x: 0.5 } : z))
    writeFileSync(caminhoJson, JSON.stringify(json, null, 2))

    try {
      await seedDocumentModels(prisma)
    } finally {
      writeFileSync(caminhoJson, conteudoOriginal)
    }

    const modelos = await prisma.documentModel.findMany({ where: { organizationId: null } })
    expect(modelos).toHaveLength(4) // não duplicou
    const depois = await prisma.documentModel.findUniqueOrThrow({ where: { id: antes!.id } })
    expect(depois.version).toBe(2)
    const zonaCnpj = (depois.definicao as { zonas: { campo: string; x: number }[] }).zonas.find((z) => z.campo === 'cnpj')
    expect(zonaCnpj?.x).toBe(0.5)
  })
})
