// apps/api/src/modules/document-reader/document-reader-models.schema.ts
import { z } from 'zod'

export const createObligationTypeSchema = z.object({
  code: z.string().trim().min(1, 'Código obrigatório'),
  name: z.string().trim().min(1, 'Nome obrigatório'),
})
export type CreateObligationTypeBody = z.infer<typeof createObligationTypeSchema>

// Coordenadas normalizadas (0..1, fração da página) — mensagem em pt-BR porque o erro do Zod
// chega direto na resposta da API (ver AppError/validação de schema do Plano A).
const coordenada = (campo: string) =>
  z.number({ invalid_type_error: `"${campo}" precisa ser um número` })
    .min(0, `"${campo}" precisa estar entre 0 e 1`)
    .max(1, `"${campo}" precisa estar entre 0 e 1`)

const ancoraSchema = z.object({
  texto: z.string().trim().min(1, 'Texto da âncora obrigatório'),
  pagina: z.number().int().min(1, 'Página precisa ser >= 1'),
  x: coordenada('x'),
  y: coordenada('y'),
})

const zonaSchema = z.object({
  campo: z.string().trim().min(1, 'Nome do campo obrigatório'),
  pagina: z.number().int().min(1, 'Página precisa ser >= 1'),
  x: coordenada('x'),
  y: coordenada('y'),
  w: coordenada('w'),
  h: coordenada('h'),
  tipo: z.enum(['cnpj', 'data', 'competencia', 'periodo_apuracao', 'moeda', 'texto'], {
    errorMap: () => ({ message: 'Tipo de campo inválido' }),
  }),
  opcional: z.boolean().optional(),
})

export const criarModeloSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório'),
  obligationTypeId: z.string().cuid(),
  ancoras: z.array(ancoraSchema).min(1, 'Marque pelo menos 1 âncora'),
  zonas: z.array(zonaSchema).min(1, 'Marque pelo menos 1 campo'),
})
export type CriarModeloBody = z.infer<typeof criarModeloSchema>

// PATCH usa o mesmo formato do POST — edição é sempre substituição completa da definição.
export const atualizarModeloSchema = criarModeloSchema
export type AtualizarModeloBody = z.infer<typeof atualizarModeloSchema>

// Mesmo shape de DocumentoExtraidoPagina/Item (apps/web/src/types/index.ts e
// engine/types.ts) — o frontend reenvia os itens já extraídos por /analisar (em memória, nunca
// repersistidos) só pra essa checagem de colisão, sem precisar subir o PDF de novo.
const itemSchema = z.object({
  str: z.string(),
  x: coordenada('x'),
  y: coordenada('y'),
  w: coordenada('w'),
  h: coordenada('h'),
})
const paginaSchema = z.object({
  numero: z.number().int().min(1),
  itens: z.array(itemSchema),
  largura: z.number().optional(),
  altura: z.number().optional(),
})

export const verificarColisaoSchema = z.object({
  paginas: z.array(paginaSchema).min(1),
  ancoras: z.array(ancoraSchema).min(1),
  excluirModeloId: z.string().cuid().optional(),
})
export type VerificarColisaoBody = z.infer<typeof verificarColisaoSchema>
