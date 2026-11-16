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
  /** false when the viewer must assume the task before changing it (colleague's task) */
  viewerCanEdit?: boolean
  // OS: model, release (null = waiting for other OS), clock and delay reason
  osModelId?: string | null
  osModel?: { id: string; name: string } | null
  releasedAt?: string | null
  deadline?: DeadlineInfo
  waitingFor?: string[]
  delayReasonId?: string | null
  delayReasonPending?: boolean
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
  processTemplateId?: string | null
  // Month of the process (AAAA-MM-01 UTC): OS of a period added later default to it
  competence?: string | null
  type: 'PROCESS' | 'RECURRING_SYSTEM' | 'SERVICE_SYSTEM'
  columns: Column[]
  client: { id: string; name: string; codigo: string | null }
  // Process clock (business days, pauses while the client is awaited) and delay reason
  deadlineBusinessDays?: number | null
  targetDate?: string | null
  completedAt?: string | null
  delayReasonId?: string | null
  delayReasonPending?: boolean
  deadline?: DeadlineInfo
}

export interface User {
  id: string
  name: string
  email: string
  role: 'MASTER' | 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
  phone: string | null
  isActive: boolean
  createdAt: string
  departments?: { id: string; name: string }[]
  seesDepartmentWork?: boolean
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
  // What the file was for and how it ended (document trail)
  purpose?: AttachmentPurpose | null
}

export type AttachmentPurpose =
  | { kind: 'REQUIREMENT'; name: string; review: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'REPLACED' | null; rejectionReason: string | null; reviewedByName: string | null; reviewedAt: string | null; current: boolean }
  | { kind: 'DELIVERABLE'; name: string }
  | { kind: 'APPROVAL_FILE'; name: string; review: string }
  | { kind: 'APPROVAL_PROOF'; name: string }
  | { kind: 'PROTOCOL'; name: string }

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
  // Temporary download link (signed)
  url: string
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
  // Service of the catalog the client asked for (standalone OS model or process) and its period
  osModelId?: string | null
  processTemplateId?: string | null
  processTemplate?: { id: string; name: string } | null
  competence?: string | null
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
  competence?: string | null
  requiresPayment?: boolean
  amount?: string | null
  paidAt?: string | null
  paidAmount?: string | null
  cancelledAt?: string | null
  cancellationReason?: string | null
  fileUpdatedAt?: string | null
  deliverableId?: string | null
  client?: { id: string; name: string }
  attachment?: { filename: string } | null
  events?: ProtocolEvent[]
  boardId?: string   // só presente em GET /protocols (listagem da org) — ver protocols.service.ts
  // Where its task opens (Tarefas for a recurring task, the board for a process)
  link?: string
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
  // Robot: obligation the document reader recognizes for this delivered document
  obligationTypeId: string | null
}

export interface RecurringTaskTemplate {
  id: string
  departmentId: string
  department: { id: string; name: string }
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
  status: 'PENDING' | 'UPLOADED' | 'APPROVED' | 'REJECTED' | 'NOT_APPLICABLE'
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
  requiresPayment: boolean
  amount: string | null
  paymentDueDate: string | null
  // set when the robot checks files delivered here (obligation the document must be)
  obligationTypeId?: string | null
}

// Answer of POST /tasks/:id/documents/deliveries/:reqId/check
export interface DeliveryCheck {
  blocked?: string
  warnings: string[]
  read: { amount?: string; dueDate?: string }
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

export interface ProcessTemplateColumnDocumentItem { id: string; name: string; position: number }
export interface ProcessTemplateColumn {
  id: string; title: string; position: number
  statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'
  notifyClient: boolean
  documents: ProcessTemplateColumnDocumentItem[]
}
export interface ProcessTemplateItem {
  id: string; osModelId: string; osModel: { id: string; name: string }; columnPosition: number; position: number
  // indexes of the items (same list) this OS waits for
  dependsOn: number[]
}
export interface ProcessTemplate {
  id: string; name: string; description: string | null; isActive: boolean
  departmentId: string | null; deadlineBusinessDays: number | null; clientCanRequest: boolean
  columns: ProcessTemplateColumn[]
  items: ProcessTemplateItem[]
}

// Clock of an OS or process (API os-deadline.service deadlineInfo)
export type DeadlineState = 'NONE' | 'ON_TIME' | 'DUE_SOON' | 'LATE' | 'PAUSED' | 'WAITING_DEPENDENCY' | 'DONE'
export interface DeadlineInfo {
  state: DeadlineState
  businessDaysLeft?: number
  businessDaysLate?: number
  pausedSinceDays?: number
  officeBusinessDays: number
  clientBusinessDays: number
}

// Catalog of "Solicitar serviço" in the portal
export interface PortalService { kind: 'OS' | 'PROCESS'; id: string; name: string; description: string | null; departmentId: string; requiresCompetence: boolean }

export interface DelayReason { id: string; name: string; requiresNote: boolean; isActive: boolean; position: number }

export interface OSModelDocument { id: string; name: string; position: number; requiresPayment: boolean; obligationTypeId: string | null }
// Service order model: one task, like a recurring one but sporadic
export interface OSModel {
  id: string; name: string; description: string | null; departmentId: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; visibleToClient: boolean
  requiresCompetence: boolean; deadlineBusinessDays: number | null; autoCompleteOnAllDelivered: boolean
  usableStandalone: boolean; usableInProcess: boolean; isActive: boolean
  documentRequests: OSModelDocument[]; documentDeliveries: OSModelDocument[]
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
  // What the robot matched and checked (queue): the delivery it fills and the green/yellow checks
  suggestion?: {
    taskId: string
    taskTitle: string
    clientName: string
    competence: string | null
    deliverableId: string
    deliverableName: string
    obligationName: string | null
    requiresPayment: boolean
    amount: string | null
    paymentDueDate: string | null
    // OS (standalone or step of a process)
    osModelName?: string | null
    processTitle?: string | null
  } | null
  checks?: { cnpj: boolean; competence: boolean; payment: boolean }
  ready?: boolean
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
