// apps/api/src/modules/document-reader/document-reader-models.service.ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateObligationTypeBody } from './document-reader-models.schema'

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
