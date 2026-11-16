import { describe, it, expect } from 'vitest'
import {
  createProcessTemplate,
  updateProcessTemplate,
  deleteProcessTemplate,
} from '@/modules/process-templates/process-templates.service'
import { createTestPlan, createTestOrg } from '@/test/helpers'

describe('createProcessTemplate', () => {
  it('creates a template with nested columns and documents in one call', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)

    const result = await createProcessTemplate(org.id, {
      name: 'Abertura de Empresa',
      description: 'Processo padrão',
      isActive: true,
      columns: [
        {
          title: 'Documentação',
          statusEffect: 'NONE',
          notifyClient: false,
          documents: [{ name: 'RG' }, { name: 'CPF' }],
        },
        {
          title: 'Concluído',
          statusEffect: 'DONE',
          notifyClient: true,
          documents: [],
        },
      ],
    })

    expect(result.name).toBe('Abertura de Empresa')
    expect(result.organizationId).toBe(org.id)
    expect(result.columns).toHaveLength(2)
    expect(result.columns[0].title).toBe('Documentação')
    expect(result.columns[0].documents).toHaveLength(2)
    expect(result.columns[0].documents.map((d) => d.name)).toEqual(['RG', 'CPF'])
    expect(result.columns[1].statusEffect).toBe('DONE')
    expect(result.columns[1].notifyClient).toBe(true)
  })
})

describe('updateProcessTemplate', () => {
  it('replaces the whole column list — removed columns disappear, new ones appear', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const template = await createProcessTemplate(org.id, {
      name: 'Template',
      isActive: true,
      columns: [
        { title: 'Coluna A', statusEffect: 'NONE', notifyClient: false, documents: [{ name: 'Doc A' }] },
        { title: 'Coluna B', statusEffect: 'NONE', notifyClient: false, documents: [] },
      ],
    })

    const result = await updateProcessTemplate(template.id, org.id, {
      columns: [
        { title: 'Coluna C', statusEffect: 'DONE', notifyClient: true, documents: [{ name: 'Doc C' }] },
      ],
    })

    expect(result.columns).toHaveLength(1)
    expect(result.columns[0].title).toBe('Coluna C')
    expect(result.columns[0].documents.map((d) => d.name)).toEqual(['Doc C'])
    expect(result.columns.some((c) => c.title === 'Coluna A' || c.title === 'Coluna B')).toBe(false)
  })

  it('updates only the name without touching columns when columns is omitted', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const template = await createProcessTemplate(org.id, {
      name: 'Template',
      isActive: true,
      columns: [{ title: 'Coluna A', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })

    const result = await updateProcessTemplate(template.id, org.id, { name: 'Renomeado' })

    expect(result.name).toBe('Renomeado')
    expect(result.columns).toHaveLength(1)
    expect(result.columns[0].title).toBe('Coluna A')
  })

  it('throws 404 when template belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const template = await createProcessTemplate(orgA.id, {
      name: 'Template',
      isActive: true,
      columns: [{ title: 'Coluna A', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })

    await expect(
      updateProcessTemplate(template.id, orgB.id, { name: 'Outro Nome' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteProcessTemplate', () => {
  it('soft-deletes the template (isActive: false), not a hard delete', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const template = await createProcessTemplate(org.id, {
      name: 'Template',
      isActive: true,
      columns: [{ title: 'Coluna A', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })

    const result = await deleteProcessTemplate(template.id, org.id)

    expect(result.isActive).toBe(false)
    expect(result.id).toBe(template.id)
  })

  it('throws 404 when template belongs to a different organization', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const template = await createProcessTemplate(orgA.id, {
      name: 'Template',
      isActive: true,
      columns: [{ title: 'Coluna A', statusEffect: 'NONE', notifyClient: false, documents: [] }],
    })

    await expect(deleteProcessTemplate(template.id, orgB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})
