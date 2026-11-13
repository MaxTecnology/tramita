import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'
import * as b2Module from '@/lib/b2'
import * as queueModule from '@/lib/document-reader-queue'
import { multipartBody } from '@/test/multipart'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(b2Module, 'uploadFile').mockResolvedValue(undefined)
  vi.spyOn(b2Module, 'downloadFile').mockResolvedValue(Buffer.from('%PDF-1.4'))
  vi.spyOn(queueModule, 'enqueueDocumentReader').mockResolvedValue()
})

describe('POST /document-reader/upload', () => {
  it('ORG_MANAGER sobe um PDF e recebe o ReceivedDocument criado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')
    const boundary = 'boundary-doc-reader-1'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="guia.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${boundary}--`

    const res = await app.inject({
      method: 'POST', url: '/document-reader/upload',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).status).toBe('PENDING')
  })

  it('refuses a file declared as PDF whose content is not a PDF', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')
    const mp = multipartBody({}, { filename: 'pagina.html', contentType: 'application/pdf', content: '<html><script>x</script>' })

    const res = await app.inject({ method: 'POST', url: '/document-reader/upload', headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(422)
    expect(b2Module.uploadFile).not.toHaveBeenCalled()
  })

  it('stores the PDF under a safe name with the .pdf extension', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')
    const mp = multipartBody({}, { filename: 'guia #1?;.html', content: '%PDF-1.4' })

    const res = await app.inject({ method: 'POST', url: '/document-reader/upload', headers: { authorization: auth, ...mp.headers }, body: mp.body })

    expect(res.statusCode).toBe(201)
    expect(vi.mocked(b2Module.uploadFile).mock.calls[0][0]).toMatch(/-guia__1__\.pdf$/)
  })

  it('lança 413 com mensagem em pt-BR quando o PDF excede 20MB', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const auth = await getAuthHeader(member.email, 'Test@1234')
    const arquivoGrande = Buffer.alloc(21 * 1024 * 1024, 0)
    const boundary = 'boundary-doc-reader-grande'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="grande.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      arquivoGrande,
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const res = await app.inject({
      method: 'POST', url: '/document-reader/upload',
      headers: { authorization: auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body).message).toBe('Arquivo excede o limite de 20MB')
  })
})

describe('GET /document-reader/fila', () => {
  it('lista só os documentos pendentes da própria org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING' } })

    const res = await app.inject({ method: 'GET', url: '/document-reader/fila', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})

describe('GET /document-reader/rejeitados', () => {
  it('lista só os documentos REJECTED da própria org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await prisma.receivedDocument.create({
      data: { organizationId: org.id, fileHash: 'h-rejeitado', storageKey: 'k', uploadedById: admin.id, status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date() },
    })
    await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h-pendente', storageKey: 'k2', uploadedById: admin.id, status: 'PENDING' } })

    const res = await app.inject({ method: 'GET', url: '/document-reader/rejeitados', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})

describe('GET /document-reader/metricas', () => {
  it('devolve porModelo vazio quando não há decisão humana ainda', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const res = await app.inject({ method: 'GET', url: '/document-reader/metricas', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ porModelo: [] })
  })
})

describe('GET /document-reader/:id/visualizar', () => {
  it('devolve a URL assinada do PDF pro revisor conferir antes de decidir', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const doc = await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h-view-route', storageKey: 'k-view-route', uploadedById: admin.id, status: 'PENDING' } })
    vi.spyOn(b2Module, 'getSignedDownloadUrl').mockResolvedValue('https://b2.example.com/signed-url')

    const res = await app.inject({ method: 'GET', url: `/document-reader/${doc.id}/visualizar`, headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).url).toBe('https://b2.example.com/signed-url')
  })
})

describe('GET /document-reader/obrigacoes', () => {
  it('lista obrigações fiscais globais pra popular o seletor de templates recorrentes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await prisma.obligationType.create({ data: { code: 'ROTA-TESTE', name: 'Obrigação de Rota', organizationId: null } })

    const res = await app.inject({ method: 'GET', url: '/document-reader/obrigacoes', headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).some((o: { code: string }) => o.code === 'ROTA-TESTE')).toBe(true)
  })
})

describe('POST /document-reader/:id/confirmar', () => {
  it('lança 422 quando o documento não tem tarefa sugerida', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const doc = await prisma.receivedDocument.create({ data: { organizationId: org.id, fileHash: 'h', storageKey: 'k', uploadedById: admin.id, status: 'PENDING' } })

    const res = await app.inject({ method: 'POST', url: `/document-reader/${doc.id}/confirmar`, headers: { authorization: auth } })

    expect(res.statusCode).toBe(422)
  })
})
