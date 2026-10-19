// apps/api/src/modules/document-reader/document-reader-models.service.ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateObligationTypeBody, CriarModeloBody, AtualizarModeloBody } from './document-reader-models.schema'
import { extrairDocumento } from './engine/extrair-texto'
import type { DocumentoExtraido } from './engine/types'

// Mesmo princípio dos codes globais existentes (IRPJ, DAS, PGDAS-D): maiúsculas, hífen no lugar
// de espaço, qualquer caractere fora de [A-Z0-9-] removido. "Recibo RH" -> "RECIBO-RH".
// NFD decompõe "É" em "E" + marca de acento combinante antes do replace, e \p{Diacritic} remove
// só a marca — sem isso o replace final removeria o "É" inteiro (por não estar em [A-Z0-9-]),
// virando "FRIAS" em vez de "FERIAS".
function normalizarCodigo(code: string): string {
  return code
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    // Um separador como "/" vira hífen dos dois lados (do \s+ em volta dele) e depois some por
    // não estar em [A-Z0-9-], deixando "--" — colapsa em um hífen só e tira das pontas.
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function criarObligationType(organizationId: string, actor: { id: string }, data: CreateObligationTypeBody) {
  const code = normalizarCodigo(data.code)
  if (!code) throw new AppError(400, 'Código inválido')

  // Sem findFirst-antes-do-create: duas requisições concorrentes com o mesmo nome (ex.: duplo
  // clique em "+ Nova") passariam ambas pelo findFirst antes de qualquer uma criar — a
  // constraint @@unique([organizationId, code]) do schema é o que garante a unicidade de fato,
  // o catch aqui só traduz a P2002 que ela lança num 409 com mensagem legível.
  try {
    return await prisma.obligationType.create({
      data: { code, name: data.name, organizationId, createdById: actor.id },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, `Já existe uma obrigação com o código "${code}" nesta organização`)
    }
    throw err
  }
}

export async function analisarPdfParaModelagem(buffer: Buffer): Promise<DocumentoExtraido> {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let resultado: DocumentoExtraido
  try {
    resultado = await extrairDocumento(bytes)
  } catch (err) {
    throw new AppError(422, `Não foi possível ler o PDF: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!resultado.temTexto) {
    throw new AppError(422, 'PDF sem camada de texto (provavelmente escaneado) — OCR ainda não é suportado')
  }
  return resultado
}

// O motor (engine/pipeline.ts:62-63) lê o período pelo NOME literal do campo — `campos['pa']` ou
// `campos['competencia']` — não pelo `tipo`. Um campo chamado "trimestre" do tipo
// periodo_apuracao nunca seria lido, porque o motor nunca olha uma chave chamada "trimestre".
// Por isso a validação exige nome E tipo juntos, não só o tipo sozinho.
function validarCamposObrigatorios(zonas: CriarModeloBody['zonas']) {
  const nomes = new Set<string>()
  for (const z of zonas) {
    if (nomes.has(z.campo)) throw new AppError(400, `Campo "${z.campo}" repetido`)
    nomes.add(z.campo)
  }

  const cnpjValido = zonas.some((z) => z.campo === 'cnpj' && z.tipo === 'cnpj')
  if (!cnpjValido) {
    throw new AppError(400, 'Marque o campo "cnpj" (tipo CNPJ) — sem ele não há como achar o cliente')
  }

  const temCompetencia = zonas.some((z) => z.campo === 'competencia' && z.tipo === 'competencia')
  const temPeriodoApuracao = zonas.some((z) => z.campo === 'pa' && z.tipo === 'periodo_apuracao')
  if (!temCompetencia && !temPeriodoApuracao) {
    throw new AppError(400, 'Marque o campo "competencia" (tipo Competência) ou "pa" (tipo Período de apuração) — o motor só reconhece esses dois nomes pra achar o período do documento')
  }
}

async function obterObligationTypeOuFalhar(organizationId: string, obligationTypeId: string) {
  const obrigacao = await prisma.obligationType.findFirst({
    where: { id: obligationTypeId, isActive: true, OR: [{ organizationId: null }, { organizationId }] },
  })
  if (!obrigacao) throw new AppError(404, 'Obrigação não encontrada')
  return obrigacao
}

export async function listarModelos(organizationId: string) {
  const modelos = await prisma.documentModel.findMany({
    where: { isActive: true, OR: [{ organizationId: null }, { organizationId }] },
    include: { obligationType: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  return modelos.map((m) => ({
    id: m.id,
    nome: m.name,
    version: m.version,
    createdAt: m.createdAt,
    isGlobal: m.organizationId === null,
    obligationType: m.obligationType,
  }))
}

export async function criarModelo(organizationId: string, actor: { id: string }, data: CriarModeloBody) {
  validarCamposObrigatorios(data.zonas)
  const obrigacao = await obterObligationTypeOuFalhar(organizationId, data.obligationTypeId)

  return prisma.documentModel.create({
    data: {
      organizationId,
      obligationTypeId: obrigacao.id,
      name: data.nome,
      createdById: actor.id,
      definicao: { nome: data.nome, tipoImposto: obrigacao.code, ancoras: data.ancoras, zonas: data.zonas },
    },
  })
}

export async function atualizarModelo(id: string, organizationId: string, data: AtualizarModeloBody) {
  const modelo = await prisma.documentModel.findFirst({ where: { id, organizationId, isActive: true } })
  if (!modelo) throw new AppError(404, 'Modelo não encontrado')

  validarCamposObrigatorios(data.zonas)
  const obrigacao = await obterObligationTypeOuFalhar(organizationId, data.obligationTypeId)

  return prisma.documentModel.update({
    where: { id },
    data: {
      obligationTypeId: obrigacao.id,
      name: data.nome,
      version: { increment: 1 },
      definicao: { nome: data.nome, tipoImposto: obrigacao.code, ancoras: data.ancoras, zonas: data.zonas },
    },
  })
}

export async function arquivarModelo(id: string, organizationId: string) {
  const modelo = await prisma.documentModel.findFirst({ where: { id, organizationId } })
  if (!modelo) throw new AppError(404, 'Modelo não encontrado')
  return prisma.documentModel.update({ where: { id }, data: { isActive: false } })
}
