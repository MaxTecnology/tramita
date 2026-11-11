import { z } from 'zod'
import { cnpjValido, cpfValido, soDigitos } from '@/lib/documento'

const optionalText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))

const PJ_ADDRESS_FIELDS = ['cep', 'estado', 'cidade', 'bairro', 'logradouro', 'numero'] as const

export const companyFieldsSchema = z
  .object({
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
  .superRefine((data, ctx) => {
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
  })
  .transform((data) => ({
    ...data,
    cnpj: data.cnpj ? soDigitos(data.cnpj) : null,
    cpf: data.cpf ? soDigitos(data.cpf) : null,
  }))

export type CompanyFields = z.infer<typeof companyFieldsSchema>

const addressFields = {
  cep: z.string().optional(),
  estado: z.string().optional(),
  cidade: z.string().optional(),
  bairro: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
}

const clientUserLinkSchema = z.union([
  z.object({
    existingId: z.string().cuid(),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
  z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    departmentIds: z.array(z.string().cuid()).min(1),
  }),
])

export const createClientSchema = z.object({
  name: z.string().min(2),
  codigo: z.string().optional(),
  clientType: z.enum(['PF', 'PJ']).default('PJ'),
  cnpj: z.string().optional(),
  cpf: z.string().optional(),
  // Identificadores alternativos usados pelo robô de leitura de documentos fiscais (document-reader)
  // pra casar CNPJ de filial/produtor rural/contribuinte estadual quando o CNPJ principal não bate.
  cei: z.string().optional(),
  caepf: z.string().optional(),
  inscricaoEstadual: z.string().optional(),
  whatsapp: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  ...addressFields,
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário'),
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  codigo: z.string().nullable().optional(),
  clientType: z.enum(['PF', 'PJ']).optional(),
  cnpj: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  cei: z.string().nullable().optional(),
  caepf: z.string().nullable().optional(),
  inscricaoEstadual: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  cep: z.string().nullable().optional(),
  estado: z.string().nullable().optional(),
  cidade: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  logradouro: z.string().nullable().optional(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário').optional(),
})

export type CreateClientBody = z.infer<typeof createClientSchema>
export type UpdateClientBody = z.infer<typeof updateClientSchema>

export const listClientsQuerySchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
})

export const setAssignmentSchema = z.object({
  departmentId: z.string().cuid(),
  userId: z.string().cuid().nullable(),
})

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>
export type SetAssignmentBody = z.infer<typeof setAssignmentSchema>
