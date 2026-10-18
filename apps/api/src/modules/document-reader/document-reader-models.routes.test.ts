// apps/api/src/modules/document-reader/document-reader-models.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import { gerarPdfComDocumentoArrecadacao } from '@/test/pdf-helpers'

describe('POST /document-reader/obrigacoes', () => {
  it('ORG_ADMIN cria uma obrigação privada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: '/document-reader/obrigacoes',
      headers: { authorization: auth }, payload: { code: 'recibo rh', name: 'Recibo de Pagamento' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).code).toBe('RECIBO-RH')
  })

  it('ORG_MEMBER não pode criar obrigação (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: '/document-reader/obrigacoes',
      headers: { authorization: auth }, payload: { code: 'X', name: 'X' },
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('POST /document-reader/modelos/analisar', () => {
  it('devolve os itens de texto extraídos do PDF enviado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const pdf = await gerarPdfComDocumentoArrecadacao('11.222.333/0001-81', 'agosto/2026')
    const boundary = 'boundary-modelagem-1'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="amostra.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from(pdf),
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const res = await app.inject({
      method: 'POST', url: '/document-reader/modelos/analisar',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).temTexto).toBe(true)
  })
})

describe('GET/POST/PATCH/DELETE /document-reader/modelos', () => {
  it('ciclo completo: cria, lista, edita e arquiva um modelo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const obrigacao = await prisma.obligationType.create({ data: { code: 'TESTE-ROTA', name: 'Teste', organizationId: org.id } })

    const payload = {
      nome: 'Modelo via rota', obligationTypeId: obrigacao.id,
      ancoras: [{ texto: 'Fixo', pagina: 1, x: 0.1, y: 0.05 }],
      zonas: [
        { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
        { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
      ],
    }

    const criado = await app.inject({ method: 'POST', url: '/document-reader/modelos', headers: { authorization: auth }, payload })
    expect(criado.statusCode).toBe(201)
    const modeloId = JSON.parse(criado.body).id

    const lista = await app.inject({ method: 'GET', url: '/document-reader/modelos', headers: { authorization: auth } })
    expect(lista.statusCode).toBe(200)
    expect(JSON.parse(lista.body).map((m: { id: string }) => m.id)).toContain(modeloId)

    const editado = await app.inject({
      method: 'PATCH', url: `/document-reader/modelos/${modeloId}`,
      headers: { authorization: auth }, payload: { ...payload, nome: 'Modelo editado' },
    })
    expect(editado.statusCode).toBe(200)
    expect(JSON.parse(editado.body).version).toBe(2)

    const arquivado = await app.inject({ method: 'DELETE', url: `/document-reader/modelos/${modeloId}`, headers: { authorization: auth } })
    expect(arquivado.statusCode).toBe(204)

    const listaDepois = await app.inject({ method: 'GET', url: '/document-reader/modelos', headers: { authorization: auth } })
    expect(JSON.parse(listaDepois.body).map((m: { id: string }) => m.id)).not.toContain(modeloId)
  })
})
