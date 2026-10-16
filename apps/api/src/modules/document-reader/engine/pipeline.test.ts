// apps/api/src/modules/document-reader/engine/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { extrairEInterpretar, decidir, LIMIAR_CONFIANCA } from './pipeline'
import type { Modelo, Base } from './pipeline'
import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

async function gerarPdfSimples(linhas: { texto: string; x: number; y: number }[]): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 })
  const stream = doc.pipe(new PassThrough())
  const chunks: Buffer[] = []
  stream.on('data', (c) => chunks.push(c))
  for (const l of linhas) doc.fontSize(10).text(l.texto, l.x * doc.page.width, l.y * doc.page.height)
  doc.end()
  await new Promise((resolve) => stream.on('end', resolve))
  return new Uint8Array(Buffer.concat(chunks))
}

const modeloTeste: Modelo = {
  id: 'teste',
  nome: 'Modelo de Teste',
  tipoImposto: 'DARF',
  ancoras: [{ texto: 'Documento de Arrecadação', pagina: 1, x: 0.1, y: 0.05 }],
  zonas: [
    { campo: 'cnpj', pagina: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.02, tipo: 'cnpj' },
    { campo: 'competencia', pagina: 1, x: 0.1, y: 0.15, w: 0.3, h: 0.02, tipo: 'competencia' },
  ],
}

describe('extrairEInterpretar', () => {
  it('reconhece o modelo certo e lê os campos das zonas', async () => {
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-81', x: 0.1, y: 0.1 },
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.modelo).toBe('teste')
    expect(r.campos.cnpj.valor).toBe('11222333000181')
    expect(r.periodo).toBe('2026-08')
    expect(r.confianca).toBe(1)
  })

  it('status nao_identificado quando nenhum modelo reconhece', async () => {
    const pdf = await gerarPdfSimples([{ texto: 'Recibo qualquer sem âncora', x: 0.1, y: 0.1 }])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.status).toBe('nao_identificado')
  })

  it('status revisar quando dois modelos reconhecem o mesmo documento (conflito, nunca escolhe arbitrariamente)', async () => {
    const modeloConflitante: Modelo = { ...modeloTeste, id: 'conflitante', nome: 'Modelo Conflitante' }
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-81', x: 0.1, y: 0.1 },
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste, modeloConflitante])
    expect(r.status).toBe('revisar')
    expect(r.modelo).toBeUndefined() // nenhum dos dois é escolhido
  })

  it('status sem_texto quando o PDF não tem camada de texto', async () => {
    const doc = new PDFDocument({ size: 'A4' })
    const stream = doc.pipe(new PassThrough())
    const chunks: Buffer[] = []
    stream.on('data', (c) => chunks.push(c))
    doc.end()
    await new Promise((resolve) => stream.on('end', resolve))
    const r = await extrairEInterpretar(new Uint8Array(Buffer.concat(chunks)), [modeloTeste])
    expect(r.status).toBe('sem_texto')
  })

  it('retorna competenciaCab além de periodo quando a linha PA é trimestral — necessário pro casamento aceitar o mês-âncora da Task', async () => {
    const modeloTrimestral: Modelo = {
      ...modeloTeste,
      zonas: [
        ...modeloTeste.zonas,
        { campo: 'pa', pagina: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.02, tipo: 'periodo_apuracao' },
      ],
    }
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-81', x: 0.1, y: 0.1 },
      { texto: 'junho/2026', x: 0.1, y: 0.15 },
      { texto: 'PA:2º Trimestre/2026', x: 0.1, y: 0.2 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTrimestral])
    expect(r.periodo).toBe('2026-T2')
    expect(r.competenciaCab).toBe('2026-06')
  })

  it('confiança abaixo do limiar quando o CNPJ é inválido', async () => {
    const pdf = await gerarPdfSimples([
      { texto: 'Documento de Arrecadação', x: 0.1, y: 0.05 },
      { texto: '11.222.333/0001-82', x: 0.1, y: 0.1 }, // dígito verificador errado
      { texto: 'agosto/2026', x: 0.1, y: 0.15 },
    ])
    const r = await extrairEInterpretar(pdf, [modeloTeste])
    expect(r.confianca).toBeLessThan(LIMIAR_CONFIANCA)
    expect(r.status).toBe('revisar')
  })
})

describe('decidir', () => {
  const base: Base = {
    clientes: [{ id: 'c1', razao: 'Padaria Pão Quente Ltda', cnpj: '11222333000181' }],
    tarefas: [{ id: 't1', clienteId: 'c1', tipoImposto: 'DARF', competencia: '2026-08', status: 'aberta' }],
  }

  it('anexar quando exatamente 1 tarefa candidata', () => {
    const d = decidir(
      'ok', 'DARF', ['2026-08'],
      { cnpj: { bruto: '', valor: '11222333000181', valido: true } },
      [], base,
    )
    expect(d).toEqual({ acao: 'anexar', motivo: 'DARF 2026-08 de Padaria Pão Quente Ltda', tarefaId: 't1', clienteId: 'c1' })
  })

  it('revisar quando cliente não é encontrado pelo CNPJ', () => {
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '99999999000199', valido: true } }, [], base)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('Cliente não encontrado')
  })

  it('revisar quando não há tarefa aberta candidata', () => {
    const baseSemTarefa: Base = { ...base, tarefas: [] }
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '11222333000181', valido: true } }, [], baseSemTarefa)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('Sem tarefa aberta')
  })

  it('revisar quando há mais de uma tarefa candidata (ambíguo)', () => {
    const baseAmbigua: Base = { ...base, tarefas: [...base.tarefas, { id: 't2', clienteId: 'c1', tipoImposto: 'DARF', competencia: '2026-08', status: 'aberta' }] }
    const d = decidir('ok', 'DARF', ['2026-08'], { cnpj: { bruto: '', valor: '11222333000181', valido: true } }, [], baseAmbigua)
    expect(d.acao).toBe('revisar')
    expect(d.motivo).toContain('ambíguo')
  })
})
