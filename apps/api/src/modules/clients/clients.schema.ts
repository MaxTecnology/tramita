import { z } from 'zod'
import { cnpjValido, cpfValido, soDigitos } from '@/lib/documento'

const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))

const PJ_ADDRESS_FIELDS = ['cep', 'estado', 'cidade', 'bairro', 'logradouro', 'numero'] as const

const companyFieldsObject = z.object({
  name: z.string({ required_error: 'Informe o nome do cliente' }).trim().min(2, 'Informe o nome do cliente'),
  codigo: z
    .string({ required_error: 'Informe o código do cliente' })
    .trim()
    .min(1, 'Informe o código do cliente'),
  clientType: z.enum(['PF', 'PJ']).default('PJ'),
  cnpj: optionalText,
  cpf: optionalText,
  // Identificadores alternativos usados pelo robô de leitura de documentos fiscais (document-reader)
  // pra casar CNPJ de filial/produtor rural/contribuinte estadual quando o CNPJ principal não bate.
  cei: optionalText,
  caepf: optionalText,
  inscricaoEstadual: optionalText,
  whatsapp: optionalText,
  phone: optionalText,
  notes: optionalText,
  cep: optionalText,
  estado: optionalText,
  cidade: optionalText,
  bairro: optionalText,
  logradouro: optionalText,
  numero: optionalText,
  complemento: optionalText,
})

type CompanyFieldsInput = z.infer<typeof companyFieldsObject>

// Regras compartilhadas entre o schema só-empresa e o corpo completo do cadastro — Zod não deixa
// estender um schema que já tem refine/transform, então as regras ficam em funções.
function refineCompanyFields(data: CompanyFieldsInput, ctx: z.RefinementCtx) {
  if (data.clientType === 'PJ') {
    if (!data.cnpj) ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'Informe o CNPJ' })
    else if (!cnpjValido(data.cnpj)) ctx.addIssue({ code: 'custom', path: ['cnpj'], message: 'CNPJ inválido' })
    if (PJ_ADDRESS_FIELDS.some((f) => !data[f])) {
      ctx.addIssue({ code: 'custom', path: ['endereco'], message: 'Endereço completo é obrigatório para pessoa jurídica' })
    }
  } else {
    if (!data.cpf) ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'Informe o CPF' })
    else if (!cpfValido(data.cpf)) ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF inválido' })
  }
}

function normalizeDocuments<T extends { cnpj: string | null; cpf: string | null }>(data: T): T {
  return { ...data, cnpj: data.cnpj ? soDigitos(data.cnpj) : null, cpf: data.cpf ? soDigitos(data.cpf) : null }
}

export const companyFieldsSchema = companyFieldsObject.superRefine(refineCompanyFields).transform(normalizeDocuments)

export type CompanyFields = z.infer<typeof companyFieldsSchema>

const departmentIdsSchema = z.array(z.string().cuid()).min(1, 'Selecione ao menos um departamento para o usuário')

const clientUserLinkSchema = z.union([
  z.object({
    existingId: z.string().cuid(),
    departmentIds: departmentIdsSchema,
  }),
  z.object({
    name: z.string().trim().min(2, 'Informe o nome do usuário'),
    email: z.string().trim().email('E-mail inválido'),
    password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres'),
    phone: z.string().optional(),
    departmentIds: departmentIdsSchema,
  }),
])

export type ClientUserLink = z.infer<typeof clientUserLinkSchema>

// Corpo do cadastro e da edição de cliente: substituição completa (empresa + departamentos
// atendidos com responsável + usuários do portal), sempre enviado inteiro pelo formulário em abas.
export const clientBodySchema = companyFieldsObject
  .extend({
    departments: z
      .array(z.object({ departmentId: z.string().cuid(), responsibleUserId: z.string().cuid() }), {
        required_error: 'Selecione ao menos um departamento que atende o cliente',
      })
      .min(1, 'Selecione ao menos um departamento que atende o cliente'),
    clientUsers: z
      .array(clientUserLinkSchema, { required_error: 'Adicione pelo menos um usuário' })
      .min(1, 'Adicione pelo menos um usuário'),
  })
  .superRefine(refineCompanyFields)
  .transform(normalizeDocuments)

export type ClientBody = z.infer<typeof clientBodySchema>
export type ServedDepartmentInput = ClientBody['departments'][number]

export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
})

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
