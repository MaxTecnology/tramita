import { redis } from '@/lib/redis'

export interface SSEEvent {
  event: 'task:moved' | 'task:created' | 'task:updated' | 'comment:added'
  data: Record<string, unknown>
}

export async function publishBoardEvent(boardId: string, payload: SSEEvent): Promise<void> {
  try {
    await redis.publish(`board:${boardId}`, JSON.stringify(payload))
  } catch { /* ignore in test/offline environments */ }
}
