import { api } from '@/lib/api'

export type InAppType =
  | 'TASK_COMMENT' | 'REQUEST_CREATED' | 'REQUEST_COMMENT' | 'DOCUMENT_UPLOADED' | 'APPROVAL_REQUESTED' | 'APPROVAL_DECIDED'
  | 'TASK_ASSUMED' | 'TASK_ASSIGNED' | 'BOARD_ASSIGNED' | 'DOCUMENT_RECEIVED' | 'DOCUMENT_REJECTED' | 'REQUEST_STATUS'

export interface InAppNotification {
  id: string
  type: InAppType
  title: string
  body: string
  link: string
  readAt: string | null
  actorName: string | null
  createdAt: string
  clientId: string | null
  taskId: string | null
}

export interface NotificationPage { items: InAppNotification[]; nextCursor: string | null }

export const TYPE_LABEL: Record<InAppType, string> = {
  TASK_COMMENT: 'Comentário em tarefa',
  REQUEST_CREATED: 'Solicitação nova',
  REQUEST_COMMENT: 'Comentário em solicitação',
  DOCUMENT_UPLOADED: 'Documento enviado',
  APPROVAL_REQUESTED: 'Pedido de aprovação',
  APPROVAL_DECIDED: 'Aprovação respondida',
  TASK_ASSUMED: 'Tarefa assumida',
  TASK_ASSIGNED: 'Tarefa atribuída',
  BOARD_ASSIGNED: 'Processo atribuído',
  DOCUMENT_RECEIVED: 'Documento recebido',
  DOCUMENT_REJECTED: 'Documento recusado',
  REQUEST_STATUS: 'Andamento de solicitação',
}

// Which types each side can receive (filter options)
export const STAFF_TYPES: InAppType[] = ['TASK_COMMENT', 'REQUEST_CREATED', 'REQUEST_COMMENT', 'DOCUMENT_UPLOADED', 'APPROVAL_DECIDED', 'TASK_ASSUMED', 'TASK_ASSIGNED', 'BOARD_ASSIGNED']
export const CLIENT_TYPES: InAppType[] = ['TASK_COMMENT', 'DOCUMENT_RECEIVED', 'APPROVAL_REQUESTED', 'DOCUMENT_REJECTED', 'REQUEST_STATUS', 'REQUEST_COMMENT']

export const UNREAD_KEY = ['notifications-unread']
export const LIST_KEY = ['notifications']

export const notificationsApi = {
  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  list: (params: Record<string, string | number | undefined>) =>
    api.get<NotificationPage>('/notifications', { params }).then((r) => r.data),
  read: (id: string) => api.post(`/notifications/${id}/read`),
  unread: (id: string) => api.post(`/notifications/${id}/unread`),
  readAll: () => api.post('/notifications/read-all'),
  readByTask: (taskId: string) => api.post('/notifications/read-by-task', { taskId }),
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${days} d`
  return new Date(iso).toLocaleDateString('pt-BR')
}
