export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'DONE' | 'DISREGARDED' | 'BLOCKED'
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
  isFinal: boolean
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
  columns: Column[]
  client: { id: string; name: string }
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
  clientType: 'PF' | 'PJ'
  cnpj: string | null
  cpf: string | null
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
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  rejectionReason: string | null
  taskId: string | null
  departmentId: string | null
  createdAt: string
  attachments?: RequestAttachment[]
  client?: { id: string; name: string }
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
}

export interface RecurringTaskTemplate {
  id: string
  departmentId: string
  department: { id: string; name: string }
  title: string
  description: string | null
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueBusinessDayRoll: 'NONE' | 'FORWARD' | 'BACKWARD'
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
  client: { id: string; name: string }
  boardId: string
  board: { id: string; title: string }
  columnId: string
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
