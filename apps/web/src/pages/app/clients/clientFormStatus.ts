import { cnpjValido, cpfValido } from '@/lib/documento'

export type ClientType = 'PF' | 'PJ'

export interface CompanyForm {
  name: string
  codigo: string
  clientType: ClientType
  cnpj: string
  cpf: string
  cei: string
  caepf: string
  inscricaoEstadual: string
  whatsapp: string
  phone: string
  notes: string
  cep: string
  estado: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  complemento: string
}

export const EMPTY_COMPANY: CompanyForm = {
  name: '', codigo: '', clientType: 'PJ', cnpj: '', cpf: '', cei: '', caepf: '', inscricaoEstadual: '',
  whatsapp: '', phone: '', notes: '', cep: '', estado: '', cidade: '', bairro: '', logradouro: '', numero: '', complemento: '',
}

export interface ServedDepartmentForm {
  departmentId: string
  /** vazio enquanto o responsável não foi escolhido */
  responsibleUserId: string
}

export interface ClientUserLinkForm {
  existingId?: string
  name?: string
  email?: string
  password?: string
  phone?: string | null
  departmentIds: string[]
}

export interface ClientFormState {
  company: CompanyForm
  departments: ServedDepartmentForm[]
  clientUsers: ClientUserLinkForm[]
}

export interface CoverageRow {
  departmentId: string
  departmentName: string
  userCount: number
  withPhoneCount: number
  status: 'ok' | 'sem_whatsapp' | 'sem_usuario'
}

export interface ClientFormStatus {
  empresa: boolean
  departamentos: boolean
  acesso: boolean
  canSave: boolean
  coverage: CoverageRow[]
}

const PJ_ADDRESS_FIELDS = ['cep', 'estado', 'cidade', 'bairro', 'logradouro', 'numero'] as const

function isCompanyComplete(c: CompanyForm): boolean {
  if (c.name.trim().length < 2 || !c.codigo.trim()) return false
  if (c.clientType === 'PJ') return cnpjValido(c.cnpj) && PJ_ADDRESS_FIELDS.every((f) => c[f].trim())
  return cpfValido(c.cpf)
}

// Mesmas regras que a API aplica (cobertura de departamentos): a tela só habilita o Salvar quando a
// API vai aceitar, e o painel de cobertura mostra onde falta alguém.
export function computeClientFormStatus(form: ClientFormState, departmentNames: Map<string, string>): ClientFormStatus {
  const served = new Set(form.departments.map((d) => d.departmentId))

  const coverage: CoverageRow[] = form.departments.map(({ departmentId }) => {
    const users = form.clientUsers.filter((u) => u.departmentIds.includes(departmentId))
    const withPhoneCount = users.filter((u) => !!u.phone?.trim()).length
    return {
      departmentId,
      departmentName: departmentNames.get(departmentId) ?? '',
      userCount: users.length,
      withPhoneCount,
      status: users.length === 0 ? 'sem_usuario' : withPhoneCount === 0 ? 'sem_whatsapp' : 'ok',
    }
  })

  const empresa = isCompanyComplete(form.company)
  const departamentos = form.departments.length > 0 && form.departments.every((d) => !!d.responsibleUserId)
  const acesso =
    form.clientUsers.length > 0 &&
    form.clientUsers.every((u) => u.departmentIds.length > 0 && u.departmentIds.every((id) => served.has(id))) &&
    coverage.every((r) => r.status !== 'sem_usuario')

  return { empresa, departamentos, acesso, canSave: empresa && departamentos && acesso, coverage }
}
