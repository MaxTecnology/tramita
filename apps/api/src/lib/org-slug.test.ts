import { describe, it, expect } from 'vitest'
import { getOrgSlug } from './org-slug'
import { createTestPlan, createTestOrg } from '@/test/helpers'

describe('getOrgSlug', () => {
  it('devolve o slug da organização', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id, { slug: 'org-com-slug' })

    expect(await getOrgSlug(org.id)).toBe('org-com-slug')
  })

  it('devolve o próprio id quando a organização não existe', async () => {
    expect(await getOrgSlug('id-inexistente')).toBe('id-inexistente')
  })
})
