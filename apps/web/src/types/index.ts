export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED'
  position: number
  columnId: string
  assigneeId: string | null
  creatorId: string
  dueDate: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
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
  email: string
  whatsapp: string | null
  phone: string | null
  notes: string | null
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
  uploadedBy: string | null
  uploadedByClient: string | null
  uploaderName: string
  signedUrl: string
  createdAt: string
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
  createdAt: string
  attachments?: RequestAttachment[]
  client?: { id: string; name: string }
}
