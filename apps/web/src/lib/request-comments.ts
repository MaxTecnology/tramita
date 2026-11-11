import type { Comment } from '@/types'

export function hasUnseenClientReply(comments: Comment[]): boolean {
  const active = comments.filter((c) => !c.deletedAt)
  const lastClientAt = active
    .filter((c) => c.authorType === 'CLIENT')
    .map((c) => c.createdAt)
    .sort()
    .at(-1)
  if (!lastClientAt) return false

  const lastStaffAt = active
    .filter((c) => c.authorType === 'USER')
    .map((c) => c.createdAt)
    .sort()
    .at(-1)
  if (!lastStaffAt) return true

  return lastClientAt > lastStaffAt
}
