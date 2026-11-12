export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'STARTED' | 'DONE' | 'DISREGARDED' | 'BLOCKED'
  position: number
  columnId: string
  assigneeId: string | null
  creatorId: string | null
  dueDate: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  sourceRequestId: string | null
  departmentId: string | null
  competence: string | null
  targetDate: string | null
  recurringTemplateId: string | null
  visibleToClient: boolean
}

export interface Column {
  id: string
  title: string
  position: number
  color: string | null
  statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'
  notifyClient: boolean
  boardId: string
  tasks: Task[]
}

export interface Board {
  id: string
  title: string
  description: string | null
  clientId: string
  organizationId: string
  responsibleUserId: string | null
  responsibleUser: { id: string; name: string } | null
  isActive: boolean
  dueDate: string | null
  osTemplateId?: string | null
  type: 'OS' | 'RECURRING_SYSTEM'
  columns: Column[]
  client: { id: string; name: string; codigo: string | null }
}

export interface User {
  id: string
  name: string
  email: string
  role: 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
  phone: string | null
  isActive: boolean
  createdAt: string
}

export interface Client {
  id: string
  name: string
  codigo: string | null
  /** departamentos que atendem o cliente (vem em GET /clients) */
  servedDepartmentIds?: string[]
  clientType: 'PF' | 'PJ'
  cnpj: string | null
  cpf: string | null
  cei: string | null
  caepf: string | null
  inscricaoEstadual: string | null
  whatsapp: string | null
  phone: string | null
  notes: string | null
  cep: string | null
  estado: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  isActive: boolean
  createdAt: string
}

export type OrgRole = 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
export type DrawerRole = OrgRole | 'CLIENT'

export interface Comment {
  id: string
  content: string | null
  authorType: 'USER' | 'CLIENT'
  user: { id: string; name: string } | null
  client: { id: string; name: string } | null
  deletedAt: string | null
  deletedBy: string | null
  deletedByType: 'USER' | 'CLIENT' | null
  deletedContent?: string
  createdAt: string
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  uploaderName: string
  signedUrl: string | null
  createdAt: string
  deletedAt: string | null
  deletedByName: string | null
}

export interface TaskHistory {
  id: string
  action: string
  fromValue: string | null
  toValue: string | null
  actorName: string
  createdAt: string
}

export interface RequestAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
}

export interface ClientRequest {
  id: string
  title: string
  description: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'NEEDS_INFO'
  rejectionReason: string | null
  taskId: string | null
  boardId: string | null
  departmentId: string | null
  cancelledByType: 'USER' | 'CLIENT' | null
  cancellationReason: string | null
  createdAt: string
  attachments?: RequestAttachment[]
  client?: { id: string; name: string }
}

export interface ProtocolEvent {
  id: string
  type: 'SENT' | 'VIEWED' | 'DOWNLOADED' | 'EXPIRED'
  actorType: string
  actorName: string | null
  actorEmail: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export interface Protocol {
  id: string
  number: string
  title: string
  content: string | null
  dueDate: string | null
  status: 'SENT' | 'VIEWED' | 'DOWNLOADED' | 'EXPIRED'
  attachmentId: string | null
  taskId: string
  clientId: string
  createdAt: string
  client?: { id: string; name: string }
  attachment?: { filename: string } | null
  events?: ProtocolEvent[]
  boardId?: string   // só presente em GET /protocols (listagem da org) — ver protocols.service.ts
}

export interface ProtocolSummary {
  SENT: number
  VIEWED: number
  DOWNLOADED: number
  EXPIRED: number
}

export interface Department {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface RecurringTaskTemplateDocumentItem {
  id: string
  name: string
  position: number
  requiresPayment: boolean
}

export interface RecurringTaskTemplate {
  id: string
  departmentId: string
  department: { id: string; name: string }
  obligationTypeId: string | null
  title: string
  description: string | null
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  dueDayOfPeriod: number
  dueBusinessDayRoll: 'NONE' | 'FORWARD' | 'BACKWARD'
  dueMonthAnchor: number
  competenceMonthOffset: number
  targetOffsetDays: number
  targetBusinessDayRoll: 'NONE' | 'FORWARD' | 'BACKWARD'
  generationMonthOffset: number
  generationDayOfPeriod: number
  autoCompleteOnAllActivitiesDone: boolean
  notifyViaWhatsapp: boolean
  notifyViaEmail: boolean
  visibleToClient: boolean
  isActive: boolean
  documentRequests: RecurringTaskTemplateDocumentItem[]
  documentDeliveries: RecurringTaskTemplateDocumentItem[]
}

export interface RecurringTaskAssignment {
  id: string
  templateId: string
  clientId: string
  client: { id: string; name: string; codigo: string | null }
  isActive: boolean
}

export interface RecurringGenerationLog {
  id: string
  templateId: string
  clientId: string
  competence: string
  status: 'SUCCESS' | 'FAILED'
  taskId: string | null
  errorMessage: string | null
  createdAt: string
}

export interface BulkGenerationResult {
  generated: number
  alreadyExists: number
  failed: { clientName: string; errorMessage: string }[]
}

export interface BulkGenerationSummary {
  templateId: string
  templateTitle: string
  result: BulkGenerationResult
}

export interface FailedGeneration {
  templateId: string
  templateTitle: string
  clientId: string
  clientName: string
  competence: string
  dueMonth: string
  retryable: boolean
  errorMessage: string
  createdAt: string
}

export interface BulkRegenerationResult {
  regenerated: number
  failed: { clientName: string; errorMessage: string }[]
}

export interface TaskDocumentRequirement {
  id: string
  taskId: string
  name: string
  status: 'PENDING' | 'UPLOADED' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  signedUrl: string | null
  position: number
}

export interface TaskDeliverable {
  id: string
  taskId: string
  name: string
  deliveredAt: string | null
  signedUrl: string | null
  position: number
}

export interface ClientUserAccessItem {
  id: string
  clientId: string
  departmentId: string
  client: { id: string; name: string }
  department: { id: string; name: string }
}

export interface ClientUser {
  id: string
  name: string
  email: string
  phone: string | null
  isActive: boolean
  createdAt: string
  accesses: ClientUserAccessItem[]
}

export interface OSTemplateColumnDocumentItem { id: string; name: string; position: number }
export interface OSTemplateColumn {
  id: string; title: string; position: number
  statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'
  notifyClient: boolean
  documents: OSTemplateColumnDocumentItem[]
}
export interface OSTemplate {
  id: string; name: string; description: string | null; isActive: boolean
  columns: OSTemplateColumn[]
}

export interface ObligationType {
  id: string
  code: string
  name: string
}

export interface ReceivedDocument {
  id: string
  status: 'PENDING' | 'ATTACHED' | 'NOT_IDENTIFIED' | 'REJECTED'
  documentModelId: string | null
  confidence: number | null
  // Campos reais do motor misturados com marcadores internos (prefixo "_") — _erro (mensagem de
  // falha de parsing), _motivo (por que decidir() não anexou sozinho) e _possivelDuplicataDe
  // (id de outro ReceivedDocument com o mesmo número de documento) nunca têm bruto/valor/valido.
  extractedFields: Record<string, { bruto: string; valor: string | number | null; valido: boolean } | string> | null
  taskId: string | null
  how: string | null
  filename: string
  task: {
    id: string
    title: string
    competence: string | null
    client: { name: string }
    pendingDeliverables: { id: string; name: string; requiresPayment: boolean }[]
  } | null
  createdAt: string
}

export interface RejectedDocument {
  id: string
  filename: string
  reviewedBy: { id: string; name: string } | null
  reviewedAt: string | null
  createdAt: string
}

export interface DocumentModelListItem {
  id: string
  nome: string
  version: number
  createdAt: string
  isGlobal: boolean
  obligationType: { id: string; name: string }
}

export interface DocumentoExtraidoItem {
  str: string
  x: number
  y: number
  w: number
  h: number
}

export interface DocumentoExtraidoPagina {
  numero: number
  largura?: number
  altura?: number
  itens: DocumentoExtraidoItem[]
}

export interface DocumentoExtraido {
  paginas: DocumentoExtraidoPagina[]
  temTexto: boolean
}
