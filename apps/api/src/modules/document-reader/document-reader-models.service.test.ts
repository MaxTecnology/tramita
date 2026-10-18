// apps/api/src/modules/document-reader/document-reader-models.service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { criarObligationType, analisarPdfParaModelagem, listarModelos, criarModelo } from './document-reader-models.service'
import { createTestPlan, createTestOrg, createTestUser } from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

// Fora dos describe (escopo de módulo) — usado tanto por 'criarModelo' quanto por 'listarModelos'
// abaixo; declarado dentro de um describe só, ficaria fora de escopo pro outro (ReferenceError).
let contadorObrigacaoTeste = 0
async function setupObrigacao(orgId: string | null) {
  return prisma.obligationType.create({ data: { code: `TESTE-MODELO-${++contadorObrigacaoTeste}`, name: 'Teste', organizationId: orgId } })
}

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

describe('criarModelo', () => {
  it('cria um modelo privado da org, com tipoImposto derivado do code da obrigação', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    const modelo = await criarModelo(org.id, { id: admin.id }, {
      nome: 'Recibo RH modelo', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Recibo de Pagamento', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    // `definicao` é um campo Json do Prisma (Prisma.JsonValue) — sem `any`, mas também sem
    // conhecer a forma exata em runtime, então o cast é pro shape que o teste de fato verifica.
    const definicao = modelo.definicao as { tipoImposto: string; id?: unknown }
    expect(modelo.organizationId).toBe(org.id)
    expect(definicao.tipoImposto).toBe(obrigacao.code)
    expect(definicao.id).toBeUndefined() // nunca grava id próprio (commit e31b5b2)
  })

  it('lança 400 quando falta o campo cnpj', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Sem CNPJ', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [{ campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' }],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 400 quando falta competencia/periodo_apuracao', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Sem competência', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [{ campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' }],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 400 quando o campo de período tem o tipo periodo_apuracao mas um nome diferente de "pa" — o motor só lê a chave "pa" literalmente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Nome de campo errado', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'trimestre', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'periodo_apuracao' },
      ],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('aceita um campo "pa" do tipo periodo_apuracao no lugar de "competencia" (documentos trimestrais)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Modelo trimestral', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'pa', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'periodo_apuracao' },
      ],
    })).resolves.toBeDefined()
  })

  it('lança 400 quando o campo "cnpj" existe mas com tipo diferente de cnpj', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'cnpj com tipo errado', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'texto' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 400 quando há dois campos com o mesmo nome', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Campo repetido', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'cnpj', pagina: 1, x: 0.5, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 404 quando obligationTypeId pertence a outra organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-criar-modelo' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacaoDeOutraOrg = await setupObrigacao(outraOrg.id)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Modelo', obligationTypeId: obrigacaoDeOutraOrg.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('aceita obligationTypeId global (organizationId null)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacaoGlobal = await setupObrigacao(null)

    await expect(criarModelo(org.id, { id: admin.id }, {
      nome: 'Modelo com obrigação global', obligationTypeId: obrigacaoGlobal.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })).resolves.toBeDefined()
  })
})

describe('listarModelos', () => {
  it('lista modelos globais e privados da org, marcando isGlobal, não lista os de outra org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const outraOrg = await createTestOrg(plan.id, { slug: 'outra-org-listar-modelo' })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const obrigacao = await setupObrigacao(org.id)
    const outraObrigacao = await setupObrigacao(outraOrg.id)

    const meu = await criarModelo(org.id, { id: admin.id }, {
      nome: 'Meu modelo', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })
    const outroAdmin = await createTestUser(outraOrg.id, { role: 'ORG_ADMIN' })
    const deOutraOrg = await criarModelo(outraOrg.id, { id: outroAdmin.id }, {
      nome: 'Modelo de outra org', obligationTypeId: outraObrigacao.id,
      ancoras: [{ texto: 'Fixo2', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    })

    const modelos = await listarModelos(org.id)
    const idsListados = modelos.map((m) => m.id)

    expect(idsListados).toContain(meu.id)
    expect(idsListados).not.toContain(deOutraOrg.id)
    const meuNaLista = modelos.find((m) => m.id === meu.id)!
    expect(meuNaLista.isGlobal).toBe(false)
  })
})
