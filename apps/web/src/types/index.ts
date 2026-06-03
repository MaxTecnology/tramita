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
  isActive: boolean
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
  cnpj: string | null
  email: string
  whatsapp: string | null
  isActive: boolean
  createdAt: string
}
