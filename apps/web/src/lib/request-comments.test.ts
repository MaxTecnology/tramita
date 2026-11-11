import { describe, expect, it } from 'vitest'
import { hasUnseenClientReply } from './request-comments'
import type { Comment } from '@/types'

function comment(authorType: 'USER' | 'CLIENT', createdAt: string): Comment {
  return {
    id: createdAt,
    content: 'x',
    authorType,
    user: authorType === 'USER' ? { id: 'u1', name: 'Staff' } : null,
    client: authorType === 'CLIENT' ? { id: 'c1', name: 'Cliente' } : null,
    deletedAt: null,
    deletedBy: null,
    deletedByType: null,
    createdAt,
  }
}

describe('hasUnseenClientReply', () => {
  it('returns true when the last client comment is newer than the last staff comment', () => {
    const comments = [
      comment('USER', '2026-11-01T10:00:00.000Z'),
      comment('CLIENT', '2026-11-02T10:00:00.000Z'),
    ]
    expect(hasUnseenClientReply(comments)).toBe(true)
  })

  it('returns false when staff already replied after the client', () => {
    const comments = [
      comment('CLIENT', '2026-11-01T10:00:00.000Z'),
      comment('USER', '2026-11-02T10:00:00.000Z'),
    ]
    expect(hasUnseenClientReply(comments)).toBe(false)
  })

  it('returns false when there is no client comment at all', () => {
    const comments = [comment('USER', '2026-11-01T10:00:00.000Z')]
    expect(hasUnseenClientReply(comments)).toBe(false)
  })

  it('returns true when the client commented and staff never replied', () => {
    const comments = [comment('CLIENT', '2026-11-01T10:00:00.000Z')]
    expect(hasUnseenClientReply(comments)).toBe(true)
  })

  it('ignores deleted comments', () => {
    const deletedClientReply = { ...comment('CLIENT', '2026-11-03T10:00:00.000Z'), deletedAt: '2026-11-03T11:00:00.000Z' }
    const comments = [comment('USER', '2026-11-01T10:00:00.000Z'), deletedClientReply]
    expect(hasUnseenClientReply(comments)).toBe(false)
  })
})
