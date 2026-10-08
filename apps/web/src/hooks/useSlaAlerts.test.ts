import { describe, it, expect } from 'vitest'
import { buildSlaTasksParams } from './useSlaAlerts'

describe('buildSlaTasksParams', () => {
  it('filtra sempre pelo usuário logado, independente do papel (evita avalanche pra ORG_ADMIN/MANAGER)', () => {
    expect(buildSlaTasksParams('user-1')).toEqual({
      boardType: 'OS',
      openOnly: true,
      assigneeId: 'user-1',
    })
  })
})
