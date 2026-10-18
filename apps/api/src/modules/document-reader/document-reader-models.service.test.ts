// apps/api/src/modules/document-reader/document-reader-models.service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { criarObligationType, analisarPdfParaModelagem } from './document-reader-models.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

describe('criarObligationType', () => {
  it('cria uma obrigação privada da org, com code normalizado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const obrigacao = await criarObligationType(org.id, { id: admin.id }, { code: 'recibo rh', name: 'Recibo de Pagamento' })

    expect(obrigacao.code).toBe('RECIBO-RH')
    expect(obrigacao.organizationId).toBe(org.id)
    expect(obrigacao.createdById).toBe(admin.id)
  })

  it('lança 409 se já existe uma obrigação com o mesmo code nesta org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    await prisma.obligationType.create({ data: { code: 'DUPLICADA', name: 'Primeira', organizationId: org.id } })

    await expect(criarObligationType(org.id, { id: admin.id }, { code: 'duplicada', name: 'Segunda' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('não colide com o code de outra organização (unicidade é por org)', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id, { slug: 'org-b-obligation-type' })
    const adminA = await createTestUser(orgA.id, { role: 'ORG_ADMIN' })
    const adminB = await createTestUser(orgB.id, { role: 'ORG_ADMIN' })
    await criarObligationType(orgA.id, { id: adminA.id }, { code: 'RECIBO', name: 'Recibo A' })

    await expect(criarObligationType(orgB.id, { id: adminB.id }, { code: 'RECIBO', name: 'Recibo B' }))
      .resolves.toBeDefined()
  })

  it('remove o acento inteiro (letra+marca), não só a marca, ao normalizar o code', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    const obrigacao = await criarObligationType(org.id, { id: admin.id }, { code: 'Férias', name: 'Férias' })

    // Sem NFD antes do replace, "É" inteiro seria removido (fora de [A-Z0-9-]) -> "FRIAS".
    expect(obrigacao.code).toBe('FERIAS')
  })
})

describe('analisarPdfParaModelagem', () => {
  it('devolve os itens de texto já extraídos, com posição normalizada', async () => {
    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')

    const resultado = await analisarPdfParaModelagem(Buffer.from(pdf))

    expect(resultado.temTexto).toBe(true)
    expect(resultado.paginas).toHaveLength(1)
    const textos = resultado.paginas[0].itens.map((i) => i.str)
    expect(textos.some((t) => t.includes('11.222.333/0001-81'))).toBe(true)
  })

  it('lança 422 com mensagem clara quando o PDF não tem camada de texto (escaneado)', async () => {
    // PDF válido mas sem nenhum texto (cnpj/competencia vazios -> gerarPdfComDocumentoArrecadacao
    // não escreve nada na página) — isso exercita o branch `!resultado.temTexto` de
    // analisarPdfParaModelagem, não o catch de parsing. Um buffer de bytes arbitrários (como
    // '%PDF-1.4 sem texto algum') faz o pdf.js falhar o PARSING, caindo no catch de erro genérico
    // em vez do branch temTexto — os dois retornam 422, então o teste passaria por engano mesmo
    // se o branch temTexto estivesse quebrado.
    const pdf = await gerarPdfComDocumentoArrecadacao('', '')

    await expect(analisarPdfParaModelagem(Buffer.from(pdf)))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('camada de texto') })
  })
})
