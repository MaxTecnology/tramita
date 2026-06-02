export interface NotificationJob {
  event: string
  taskId: string
  organizationId: string
  clientId: string
  metadata: Record<string, string | undefined>
}

export async function enqueueNotification(_job: NotificationJob): Promise<void> {}
